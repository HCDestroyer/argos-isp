import { esPermiso } from '#core/permisos'
import { esquemasRegistrados, ref, type EsquemaJson } from '#shared/openapi/esquemas'
import { PREFIJO_API, esParametroEntero, parametrosDeRuta, type Ruta } from '#shared/rutas'

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
                interno: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'INTERNAL_TOKEN compartido con los servicios aaa y coa',
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
        if (seguridad !== 'sesion' && ruta.permiso !== null) {
            throw new Error(`${ruta.operacion}: solo las rutas con sesión llevan permiso`)
        }
        if (ruta.respuesta.status !== 204 && !ruta.respuesta.esquema) {
            throw new Error(`${ruta.operacion}: falta el schema de respuesta`)
        }
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
    respuestas[String(ruta.respuesta.status)] = ruta.respuesta.esquema
        ? {
              description: ruta.respuesta.descripcion,
              content: { 'application/json': { schema: ruta.respuesta.esquema } },
          }
        : { description: ruta.respuesta.descripcion }

    if (seguridad !== 'publico') respuestas['401'] = problema('No autenticado')
    if (seguridad === 'sesion' && ruta.permiso) respuestas['403'] = problema(`Sin el permiso ${ruta.permiso}`)
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
        ...(seguridad === 'sesion' ? { security: [{ bearer: [] }] } : {}),
        ...(seguridad === 'interno' ? { security: [{ interno: [] }] } : {}),
        ...(parametros.length > 0 ? { parameters: parametros } : {}),
    }
    if (ruta.cuerpo) {
        op.requestBody = {
            required: true,
            content: {
                'application/json': { schema: normalizar(ruta.cuerpo.toJSONSchema() as EsquemaJson) },
            },
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
