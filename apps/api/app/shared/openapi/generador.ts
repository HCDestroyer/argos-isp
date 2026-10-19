import { esPermiso } from '#core/permisos'
import { esquemasRegistrados, ref, type EsquemaJson } from '#shared/openapi/esquemas'
import {
    COOKIE_PORTAL,
    COOKIE_SESION_PANEL,
    PREFIJO_API,
    esParametroEntero,
    esStatusRedireccion,
    parametrosDeRuta,
    type Ruta,
} from '#shared/rutas'

/**
 * Genera el OpenAPI 3.1 a partir del registro de rutas.
 *
 * - Cuerpos y queries: `validator.toJSONSchema()` de VineJS, normalizado.
 * - Respuestas: el schema declarado en la ruta + respuestas Problem según seguridad, validación,
 *   parámetros, versión, idempotencia y si está implementada (501).
 * - Determinista: rutas, métodos, schemas y tags se ordenan; no hay fechas ni datos variables.
 */

const ORDEN_METODOS = ['get', 'post', 'put', 'delete'] as const

const PROBLEM_JSON = 'application/problem+json'

export interface InfoOpenApi {
    titulo: string
    version: string
    descripcion: string
}

export function generarOpenApi(rutas: Ruta[], info: InfoOpenApi): EsquemaJson {
    validarRegistro(rutas)

    const ordenadas = [...rutas].sort((a, b) => {
        const porRuta = rutaOpenApi(a.ruta).localeCompare(rutaOpenApi(b.ruta), 'en')
        return porRuta !== 0 ? porRuta : ORDEN_METODOS.indexOf(a.metodo) - ORDEN_METODOS.indexOf(b.metodo)
    })

    const paths: Record<string, Record<string, EsquemaJson>> = {}
    for (const ruta of ordenadas) {
        const path = rutaOpenApi(ruta.ruta)
        paths[path] ??= {}
        paths[path][ruta.metodo] = operacion(ruta)
    }

    const tags = [...new Set(rutas.map((r) => r.etiqueta))]
        .sort((a, b) => a.localeCompare(b, 'en'))
        .map((name) => ({ name }))

    return {
        openapi: '3.1.0',
        info: { title: info.titulo, version: info.version, description: info.descripcion },
        servers: [{ url: '/' }],
        tags,
        paths,
        components: {
            securitySchemes: {
                bearer: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'Token de sesión (POST /api/v1/auth/login) o token de API',
                },
                panel: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: COOKIE_SESION_PANEL,
                    description:
                        'Sesión del panel: cookie HttpOnly que pone POST /api/v1/auth/sesion. Solo cuenta sin ' +
                        '`Authorization`. POST, PUT y DELETE exigen `X-CSRF-Token` (el `csrf` del login o de ' +
                        'GET /me) y un `Origin` permitido; si no, 403 `csrf_invalido`',
                },
                nodo_portal: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-Argos-Nodo-Token',
                    description:
                        'Token `argn_…` de un nodo portal remoto (contrato nodo-portal.md). En `/portal/*` hace que ' +
                        'la API crea `X-Argos-Cliente-Ip`; sin él esa cabecera se ignora',
                },
                interno: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'INTERNAL_TOKEN compartido con los servicios aaa y coa',
                },
                portal: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: COOKIE_PORTAL,
                    description:
                        'Sesión del portal del cliente (cookie httpOnly que deja el acceso por código)',
                },
            },
            schemas: esquemasRegistrados(),
        },
    }
}

export function rutaOpenApi(ruta: string): string {
    return PREFIJO_API + ruta.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function validarRegistro(rutas: Ruta[]) {
    const operaciones = new Set<string>()
    const firmas = new Set<string>()
    for (const ruta of rutas) {
        if (operaciones.has(ruta.operacion)) throw new Error(`operationId duplicado: ${ruta.operacion}`)
        operaciones.add(ruta.operacion)

        const firma = `${ruta.metodo} ${rutaOpenApi(ruta.ruta)}`
        if (firmas.has(firma)) throw new Error(`Ruta duplicada: ${firma}`)
        firmas.add(firma)

        const seguridad = ruta.seguridad ?? 'sesion'
        if (ruta.permiso !== null && !esPermiso(ruta.permiso)) {
            throw new Error(`${ruta.operacion}: el permiso ${ruta.permiso} no está en app/core/permisos.ts`)
        }
        if (ruta.nodoPortal && (seguridad !== 'sesion' || ruta.permiso !== null)) {
            throw new Error(`${ruta.operacion}: nodoPortal solo en rutas con sesión y sin permiso`)
        }
        if (seguridad !== 'sesion' && ruta.permiso !== null) {
            throw new Error(`${ruta.operacion}: solo las rutas con sesión llevan permiso`)
        }
        const binaria = ruta.respuesta.contenido !== undefined && !esJson(ruta.respuesta.contenido)
        const redireccion = esStatusRedireccion(ruta.respuesta.status)
        if (redireccion && (ruta.respuesta.esquema || ruta.respuesta.contenido)) {
            throw new Error(`${ruta.operacion}: una redirección no lleva schema ni contenido`)
        }
        if (ruta.respuesta.status !== 204 && !redireccion && !ruta.respuesta.esquema && !binaria) {
            throw new Error(`${ruta.operacion}: falta el schema de respuesta`)
        }
        if (binaria && ruta.respuesta.esquema) {
            throw new Error(`${ruta.operacion}: una respuesta binaria no lleva schema`)
        }
        if (ruta.multipart && !ruta.cuerpo) {
            throw new Error(`${ruta.operacion}: multipart necesita el validador de los campos (cuerpo)`)
        }
    }
}

function esJson(contenido: string): boolean {
    return contenido === 'application/json' || contenido.endsWith('+json')
}

/** Contenido de la respuesta exitosa: JSON con su schema o binario (`format: binary`). */
function contenidoRespuesta(ruta: Ruta): EsquemaJson | undefined {
    const { contenido = 'application/json', esquema } = ruta.respuesta
    if (!esJson(contenido)) return { [contenido]: { schema: { type: 'string', format: 'binary' } } }
    return esquema ? { [contenido]: { schema: esquema } } : undefined
}

/** Cuerpo multipart: campos del validador + archivos binarios. */
function cuerpoMultipart(ruta: Ruta): EsquemaJson {
    const campos = normalizar(ruta.cuerpo!.toJSONSchema() as EsquemaJson)
    const archivos = ruta.multipart!.archivos
    const opcionales = new Set(ruta.multipart!.archivosOpcionales ?? [])
    const propiedades = {
        ...((campos.properties ?? {}) as Record<string, EsquemaJson>),
        ...Object.fromEntries(
            Object.entries(archivos).map(([nombre, descripcion]) => [
                nombre,
                { type: 'string', format: 'binary', description: descripcion },
            ]),
        ),
    }
    const requeridos = [
        ...((campos.required ?? []) as string[]),
        ...Object.keys(archivos).filter((nombre) => !opcionales.has(nombre)),
    ]
    return {
        ...campos,
        type: 'object',
        properties: propiedades,
        ...(requeridos.length > 0 ? { required: requeridos } : {}),
    }
}

function problema(descripcion: string): EsquemaJson {
    return { description: descripcion, content: { [PROBLEM_JSON]: { schema: ref('Problem') } } }
}

function operacion(ruta: Ruta): EsquemaJson {
    const seguridad = ruta.seguridad ?? 'sesion'
    const parametros: EsquemaJson[] = []

    for (const nombre of parametrosDeRuta(ruta.ruta)) {
        const schema =
            ruta.parametros?.[nombre] ??
            (esParametroEntero(nombre) ? { type: 'integer', minimum: 1 } : { type: 'string' })
        parametros.push({ name: nombre, in: 'path', required: true, schema })
    }

    if (ruta.query) {
        const schema = normalizar(ruta.query.toJSONSchema() as EsquemaJson)
        const propiedades = (schema.properties ?? {}) as Record<string, EsquemaJson>
        const requeridos = new Set((schema.required ?? []) as string[])
        for (const [nombre, prop] of Object.entries(propiedades)) {
            const { description, ...resto } = prop
            parametros.push({
                name: nombre,
                in: 'query',
                required: requeridos.has(nombre),
                ...(typeof description === 'string' ? { description } : {}),
                schema: resto,
            })
        }
    }

    if (ruta.idempotente) {
        parametros.push({
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: 'Clave única por intento lógico; repetirla devuelve la misma respuesta',
            schema: { type: 'string', minLength: 1, maxLength: 255 },
        })
    }

    const respuestas: Record<string, EsquemaJson> = {}
    const contenido = contenidoRespuesta(ruta)
    respuestas[String(ruta.respuesta.status)] = esStatusRedireccion(ruta.respuesta.status)
        ? {
              description: ruta.respuesta.descripcion,
              headers: {
                  Location: {
                      description: 'URL de destino de la redirección',
                      required: true,
                      schema: { type: 'string', format: 'uri-reference' },
                  },
              },
          }
        : contenido
          ? { description: ruta.respuesta.descripcion, content: contenido }
          : { description: ruta.respuesta.descripcion }

    if (ruta.respuesta.etag) {
        respuestas['304'] = { description: 'Sin cambios: el `If-None-Match` coincide con el `ETag` actual' }
    }

    if (seguridad === 'portal') {
        respuestas['401'] = problema('Sin sesión del portal (cookie vencida o ausente)')
    } else if (seguridad !== 'publico') respuestas['401'] = problema('No autenticado')
    if (seguridad === 'sesion') {
        const csrf = ruta.metodo === 'get' ? null : 'CSRF inválido con la cookie del panel (`csrf_invalido`)'
        const permiso = ruta.permiso ? `Sin el permiso ${ruta.permiso}` : null
        const motivos = [permiso, csrf].filter((m): m is string => m !== null)
        if (motivos.length > 0) respuestas['403'] = problema(motivos.join('; o '))
    }
    if (parametrosDeRuta(ruta.ruta).length > 0) respuestas['404'] = problema('No encontrado')
    if (ruta.versionada || ruta.idempotente) {
        respuestas['409'] = problema(
            ruta.versionada ? 'Conflicto de versión' : 'Petición idempotente en curso',
        )
    }
    if (ruta.cuerpo || ruta.query || ruta.idempotente) respuestas['422'] = problema('Datos inválidos')
    if (ruta.limitada) {
        respuestas['429'] = problema('Demasiadas peticiones; reintentar después de `Retry-After` segundos')
    }
    if (!ruta.handler) respuestas['501'] = problema('No implementado todavía')

    const op: EsquemaJson = {
        operationId: ruta.operacion,
        summary: ruta.resumen,
        ...(ruta.descripcion ? { description: ruta.descripcion } : {}),
        tags: [ruta.etiqueta],
        ...(seguridad === 'sesion'
            ? {
                  security: ruta.nodoPortal
                      ? [{ bearer: [] }, { panel: [] }, { nodo_portal: [] }]
                      : [{ bearer: [] }, { panel: [] }],
              }
            : {}),
        ...(seguridad === 'interno' ? { security: [{ interno: [] }] } : {}),
        ...(seguridad === 'portal' ? { security: [{ portal: [] }] } : {}),
        ...(parametros.length > 0 ? { parameters: parametros } : {}),
    }
    if (ruta.cuerpo) {
        op.requestBody = {
            required: true,
            content: ruta.multipart
                ? { 'multipart/form-data': { schema: cuerpoMultipart(ruta) } }
                : { 'application/json': { schema: normalizar(ruta.cuerpo.toJSONSchema() as EsquemaJson) } },
        }
    }
    op.responses = respuestas
    if (ruta.permiso) op['x-permiso'] = ruta.permiso
    op['x-implementado'] = Boolean(ruta.handler)
    return op
}

const VALORES_BOOLEANOS_VINE = new Set<unknown>(['1', 1, 'true', true, 'on', '0', 0, 'false', false])

/**
 * Ajusta el JSON Schema de VineJS para OpenAPI:
 * - `vine.boolean()` se expone como `enum` de valores coercibles → `{ type: 'boolean' }`.
 * - `enum` de strings sin `type` → agrega `type: 'string'`.
 */
export function normalizar(esquema: EsquemaJson): EsquemaJson {
    const salida: EsquemaJson = {}
    for (const [clave, valor] of Object.entries(esquema)) {
        salida[clave] = normalizarValor(valor)
    }

    const valores = salida.enum
    if (Array.isArray(valores)) {
        if (
            valores.length === VALORES_BOOLEANOS_VINE.size &&
            valores.every((v) => VALORES_BOOLEANOS_VINE.has(v))
        ) {
            delete salida.enum
            salida.type = 'boolean'
        } else if (salida.type === undefined && valores.every((v) => typeof v === 'string')) {
            return { type: 'string', ...salida }
        }
    }
    return salida
}

function normalizarValor(valor: unknown): unknown {
    if (Array.isArray(valor)) return valor.map(normalizarValor)
    if (valor !== null && typeof valor === 'object') return normalizar(valor as EsquemaJson)
    return valor
}
