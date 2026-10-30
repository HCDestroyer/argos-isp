import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import type { ClaseQosFixture, PerfilQosFila, ReglaQosFixture } from './datos'
import { regla } from './datos'
import { perfilEfectivoId } from './costo'
import { costoQos, validarPerfil } from './validar'
import { QOS_MAX_HOJAS } from '../routers/estrategiasDatos'
import { conQos, efectiva, planesDelRouter } from '../routers/estrategias'
import { TIPOS_CONEXION_VELOCIDAD } from '../../app/types/controlVelocidad'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresasDeLista, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'

/**
 * QoS por clases (`contratos/qos.md` §4, A2): perfiles, clases y el perfil de un router, con las
 * reglas de `validarPerfil()` y el costo contra `QOS_MAX_HOJAS`. Todas las escrituras son la acción
 * `qos.gestionar`. Errores con los mismos `field`, `rule` y textos de la API.
 */

type Errores = NonNullable<Problem['errors']>
const PROTOCOLOS = ['tcp', 'udp', 'icmp'] as const

function clasesDe(perfilId: number): ClaseQosFixture[] {
    // Como `clasesDePerfil`: activas primero, por orden y por id.
    return bd.qosClases
        .filter(c => c.perfil_id === perfilId)
        .sort((a, b) => Number(b.activa) - Number(a.activa) || a.orden - b.orden || a.id - b.id)
}

function vistaPerfil(fila: PerfilQosFila): Schema<'PerfilQos'> {
    const clases = structuredClone(clasesDe(fila.id))
    return { ...fila, clases, advertencias: validarPerfil(clases).advertencias }
}

/** Planes del router con `qos` en su estrategia efectiva (`planesConQos`). */
function planesConQos(router: Schema<'Router'>): number {
    return planesDelRouter(router.id).filter(p => TIPOS_CONEXION_VELOCIDAD.some(t => conQos(efectiva(router.estrategia_velocidad, p.excepcion, t)))).length
}

/** `usoPerfil()`: routers activos con este perfil (el suyo o el predeterminado) y su costo. */
function usoPerfil(perfilId: number, clases: ClaseQosFixture[] = clasesDe(perfilId)): Schema<'UsoPerfilQos'>[] {
    return bd.routers
        .filter(r => r.activo && perfilEfectivoId(r) === perfilId)
        .sort((a, b) => a.id - b.id)
        .map(r => ({ router_id: r.id, nombre: r.nombre, ...costoQos(clases, planesConQos(r)) }))
}

/** `exigirPerfilValido()`: 422 con los `field` de la clase sin el prefijo `clases.<id>.`, y el costo. */
function perfilInvalido(perfilId: number, clases: ClaseQosFixture[], claseId: number): RespuestaFixture | null {
    const prefijo = `clases.${claseId}.`
    const errores: Errores = validarPerfil(clases).errores.map(e => ({ ...e, field: e.field.startsWith(prefijo) ? e.field.slice(prefijo.length) : e.field }))
    if (errores.length) {
        return problemaTipado(422, 'validacion', 'Datos inválidos', `El perfil de QoS no sería válido: ${errores[0]?.message ?? ''}`, errores)
    }
    for (const uso of usoPerfil(perfilId, clases)) {
        if (uso.hojas > QOS_MAX_HOJAS) {
            return problemaTipado(422, 'validacion', 'Datos inválidos', `El router ${uso.nombre} pasaría del límite de QoS`, [{
                field: 'activa',
                rule: 'qos_costo',
                message: `el router ${uso.nombre} pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${uso.planes_qos} planes × 4 × ${uso.clases} clases = ${uso.hojas}): apaga qos en sus planes dedicados o usa menos clases`,
            }])
        }
    }
    return null
}

const entero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Lo que revisaría VineJS (`crearClaseQosValidator` / `editarClaseQosValidator`). */
function erroresCuerpo(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    const rango = (campo: string, min: number, max: number, opcional: boolean, nulo = false) => {
        const v = cuerpo[campo]
        if (v === undefined && opcional) {
            return
        }
        if (v === null && nulo) {
            return
        }
        if (!entero(v) || v < min || v > max) {
            errores.push({ field: campo, rule: 'range', message: `Debe ser un entero entre ${min} y ${max}` })
        }
    }
    if (!parcial || cuerpo.nombre !== undefined) {
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 1 || nombre.length > 80) {
            errores.push({ field: 'nombre', rule: 'minLength', message: 'Escribe un nombre de 1 a 80 caracteres' })
        }
    }
    rango('orden', 1, 1000, parcial)
    rango('prioridad', 1, 8, parcial)
    rango('garantizado_pct', 0, 100, true)
    rango('tope_pct', 1, 100, true, true)
    rango('bytes_minimo', 1, 1_000_000_000_000, true, true)
    if (Array.isArray(cuerpo.reglas)) {
        cuerpo.reglas.forEach((r: unknown, i) => {
            const fila = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
            if (fila.protocolo !== undefined && fila.protocolo !== null && !(PROTOCOLOS as readonly unknown[]).includes(fila.protocolo)) {
                errores.push({ field: `reglas.${i}.protocolo`, rule: 'enum', message: 'Elige tcp, udp, icmp o cualquiera' })
            }
            if (fila.dscp !== undefined && fila.dscp !== null && (!entero(fila.dscp) || fila.dscp < 0 || fila.dscp > 63)) {
                errores.push({ field: `reglas.${i}.dscp`, rule: 'range', message: 'DSCP va de 0 a 63' })
            }
            if (typeof fila.lista_destino === 'string' && fila.lista_destino.trim() && !/^[A-Za-z0-9._-]{1,63}$/.test(fila.lista_destino.trim())) {
                errores.push({ field: `reglas.${i}.lista_destino`, rule: 'regex', message: 'Solo letras, dígitos, punto, guion y guion bajo (máx. 63)' })
            }
        })
    }
    return errores
}

/** `reglaCompleta()`: lo vacío queda null. */
function reglasDe(valor: unknown): ReglaQosFixture[] {
    if (!Array.isArray(valor)) {
        return []
    }
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return valor.map((r: unknown) => {
        const fila = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
        return regla({
            protocolo: (PROTOCOLOS as readonly unknown[]).includes(fila.protocolo) ? fila.protocolo as ReglaQosFixture['protocolo'] : null,
            puertos_destino: texto(fila.puertos_destino),
            puertos_origen: texto(fila.puertos_origen),
            dscp: entero(fila.dscp) ? fila.dscp : null,
            lista_destino: texto(fila.lista_destino),
        })
    })
}

function nombreRepetido(perfilId: number, nombre: string, excepto: number | null): RespuestaFixture | null {
    const repetida = bd.qosClases.find(c => c.perfil_id === perfilId && c.id !== excepto && c.nombre.toLowerCase() === nombre.trim().toLowerCase())
    return repetida ? problemaTipado(409, 'qos_nombre_duplicado', 'Conflicto', `El perfil ya tiene una clase «${repetida.nombre}»`) : null
}

function perfilDe(solicitud: SolicitudFixture): PerfilQosFila | undefined {
    return bd.qosPerfiles.find(p => p.id === idDe(solicitud))
}

function cambiarEstado(solicitud: SolicitudFixture, activa: boolean): RespuestaFixture {
    const clase = bd.qosClases.find(c => c.id === idDe(solicitud))
    if (!clase) {
        return noEncontrado('la clase de QoS')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== clase.version) {
        return versionCambiada()
    }
    if (clase.activa === activa) {
        return { status: 200, cuerpo: clase }
    }
    if (clase.es_resto && !activa) {
        return problemaTipado(422, 'validacion', 'Datos inválidos', 'La clase resto no se puede desactivar', [{ field: 'id', rule: 'qos_resto', message: '«resto» no se desactiva: es lo que no coincide con nada' }])
    }
    const invalido = perfilInvalido(clase.perfil_id, clasesDe(clase.perfil_id).map(c => (c.id === clase.id ? { ...c, activa } : c)), clase.id)
    if (invalido) {
        return invalido
    }
    Object.assign(clase, { activa, version: clase.version + 1, updated_at: ahora() })
    registrarAccion(solicitud, 'qos.gestionar', { tipo: 'qos_clase', id: clase.id }, cuerpo)
    return { status: 200, cuerpo: clase }
}

export const rutasQos: RutasFixture = {
    'GET /api/v1/qos/perfiles': conPermiso('qos.ver', (solicitud) => {
        const empresas = empresasDeLista(solicitud)
        const filas = bd.qosPerfiles
            .filter(p => p.empresa_id === null || empresas === null || empresas.includes(p.empresa_id))
            .sort((a, b) => a.id - b.id)
            .map(vistaPerfil)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/qos/perfiles/:id': conPermiso('qos.ver', (solicitud) => {
        const perfil = perfilDe(solicitud)
        if (!perfil) {
            return noEncontrado('el perfil de QoS')
        }
        const detalle: Schema<'PerfilQosDetalle'> = { ...vistaPerfil(perfil), routers: usoPerfil(perfil.id) }
        return { status: 200, cuerpo: detalle }
    }),

    /** `CrearPerfilQos`: copia las clases activas de `copiar_de` (o del predeterminado). */
    'POST /api/v1/qos/perfiles': conPermiso('qos.gestionar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 1 || nombre.length > 120) {
            return datosInvalidos([{ field: 'nombre', rule: 'minLength', message: 'Escribe un nombre de 1 a 120 caracteres' }])
        }
        const empresaId = entero(cuerpo.empresa_id) ? cuerpo.empresa_id : null
        const origen = entero(cuerpo.copiar_de) ? bd.qosPerfiles.find(p => p.id === cuerpo.copiar_de) : bd.qosPerfiles.find(p => p.predeterminado)
        if (!origen || (origen.empresa_id !== null && origen.empresa_id !== empresaId)) {
            return noEncontrado('el perfil de QoS de origen')
        }
        if (bd.qosPerfiles.some(p => p.empresa_id === empresaId && p.nombre.toLowerCase() === nombre.toLowerCase())) {
            return problemaTipado(409, 'qos_nombre_duplicado', 'Conflicto', `Ya existe el perfil de QoS «${nombre}»`)
        }
        const momento = ahora()
        const fila: PerfilQosFila = {
            id: siguienteId(bd.qosPerfiles),
            empresa_id: empresaId,
            nombre,
            descripcion: typeof cuerpo.descripcion === 'string' && cuerpo.descripcion.trim() ? cuerpo.descripcion.trim() : null,
            predeterminado: false,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.qosPerfiles.push(fila)
        const nuevos = new Map<number, number>()
        const activas = clasesDe(origen.id).filter(c => c.activa)
        for (const c of activas) {
            const id = siguienteId(bd.qosClases)
            nuevos.set(c.id, id)
            bd.qosClases.push({ ...structuredClone(c), id, perfil_id: fila.id, reclasifica_de: [], version: 1, created_at: momento, updated_at: momento })
        }
        for (const c of activas) {
            const copia = bd.qosClases.find(x => x.id === nuevos.get(c.id))
            if (copia) {
                copia.reclasifica_de = c.reclasifica_de.map(o => nuevos.get(o)).filter((o): o is number => o !== undefined)
            }
        }
        registrarAccion(solicitud, 'qos.gestionar', { tipo: 'qos_perfil', id: fila.id }, cuerpo)
        return { status: 201, cuerpo: vistaPerfil(fila) }
    })),

    'POST /api/v1/qos/perfiles/:id/clases': conPermiso('qos.gestionar', conIdempotencia((solicitud) => {
        const perfil = perfilDe(solicitud)
        if (!perfil) {
            return noEncontrado('el perfil de QoS')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = erroresCuerpo(cuerpo, false)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const repetido = nombreRepetido(perfil.id, String(cuerpo.nombre), null)
        if (repetido) {
            return repetido
        }
        const momento = ahora()
        const nueva: ClaseQosFixture = {
            id: -1,
            perfil_id: perfil.id,
            nombre: String(cuerpo.nombre).trim(),
            orden: Number(cuerpo.orden),
            prioridad: Number(cuerpo.prioridad),
            garantizado_pct: entero(cuerpo.garantizado_pct) ? cuerpo.garantizado_pct : 0,
            tope_pct: entero(cuerpo.tope_pct) ? cuerpo.tope_pct : null,
            es_resto: false,
            reglas: reglasDe(cuerpo.reglas),
            bytes_minimo: entero(cuerpo.bytes_minimo) ? cuerpo.bytes_minimo : null,
            reclasifica_de: Array.isArray(cuerpo.reclasifica_de) ? cuerpo.reclasifica_de.filter(entero) : [],
            activa: true,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        const invalido = perfilInvalido(perfil.id, [...clasesDe(perfil.id), nueva], -1)
        if (invalido) {
            return invalido
        }
        nueva.id = siguienteId(bd.qosClases)
        bd.qosClases.push(nueva)
        registrarAccion(solicitud, 'qos.gestionar', { tipo: 'qos_clase', id: nueva.id }, cuerpo)
        return { status: 201, cuerpo: nueva }
    })),

    /** `EditarClaseQos`: lo ausente queda igual; 409 por `version`. */
    'PUT /api/v1/qos/clases/:id': conPermiso('qos.gestionar', (solicitud) => {
        const clase = bd.qosClases.find(c => c.id === idDe(solicitud))
        if (!clase) {
            return noEncontrado('la clase de QoS')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = erroresCuerpo(cuerpo, true)
        if (!entero(cuerpo.version)) {
            errores.push({ field: 'version', rule: 'required', message: 'Envía la version que leíste' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== clase.version) {
            return versionCambiada()
        }
        const despues: ClaseQosFixture = {
            ...clase,
            nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : clase.nombre,
            orden: entero(cuerpo.orden) ? cuerpo.orden : clase.orden,
            prioridad: entero(cuerpo.prioridad) ? cuerpo.prioridad : clase.prioridad,
            garantizado_pct: entero(cuerpo.garantizado_pct) ? cuerpo.garantizado_pct : clase.garantizado_pct,
            tope_pct: cuerpo.tope_pct === undefined ? clase.tope_pct : entero(cuerpo.tope_pct) ? cuerpo.tope_pct : null,
            reglas: Array.isArray(cuerpo.reglas) ? reglasDe(cuerpo.reglas) : clase.reglas,
            bytes_minimo: cuerpo.bytes_minimo === undefined ? clase.bytes_minimo : entero(cuerpo.bytes_minimo) ? cuerpo.bytes_minimo : null,
            reclasifica_de: Array.isArray(cuerpo.reclasifica_de) ? cuerpo.reclasifica_de.filter(entero) : clase.reclasifica_de,
        }
        if (JSON.stringify(despues) === JSON.stringify(clase)) {
            return { status: 200, cuerpo: clase }
        }
        if (despues.nombre !== clase.nombre) {
            const repetido = nombreRepetido(clase.perfil_id, despues.nombre, clase.id)
            if (repetido) {
                return repetido
            }
        }
        const invalido = perfilInvalido(clase.perfil_id, clasesDe(clase.perfil_id).map(c => (c.id === clase.id ? despues : c)), clase.id)
        if (invalido) {
            return invalido
        }
        Object.assign(clase, despues, { version: clase.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'qos.gestionar', { tipo: 'qos_clase', id: clase.id }, cuerpo)
        return { status: 200, cuerpo: clase }
    }),

    'POST /api/v1/qos/clases/:id/desactivar': conPermiso('qos.gestionar', conIdempotencia(solicitud => cambiarEstado(solicitud, false))),
    'POST /api/v1/qos/clases/:id/activar': conPermiso('qos.gestionar', conIdempotencia(solicitud => cambiarEstado(solicitud, true))),

    /** `AsignarPerfilQos`: común o de la empresa sugerida del router (422 `qos_empresa`) y dentro del límite. */
    'POST /api/v1/routers/:id/qos-perfil': conPermiso('qos.gestionar', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        const perfilId = entero(cuerpo.qos_perfil_id) ? cuerpo.qos_perfil_id : null
        const perfil = perfilId === null ? null : bd.qosPerfiles.find(p => p.id === perfilId)
        if (perfilId !== null && !perfil) {
            return noEncontrado('el perfil de QoS')
        }
        if (perfil && perfil.empresa_id !== null && perfil.empresa_id !== router.empresa_sugerida_id) {
            return problemaTipado(422, 'validacion', 'Datos inválidos', 'El perfil de QoS no se puede usar en este router', [{
                field: 'qos_perfil_id',
                rule: 'qos_empresa',
                message: 'el perfil es de otra empresa: un router solo usa perfiles comunes o de su empresa sugerida',
            }])
        }
        if ((router.qos_perfil_id ?? null) === perfilId) {
            return { status: 200, cuerpo: router }
        }
        const efectivo = perfilId ?? bd.qosPerfiles.find(p => p.predeterminado)?.id ?? null
        if (efectivo !== null) {
            const uso = { nombre: router.nombre, ...costoQos(clasesDe(efectivo), planesConQos(router)) }
            if (uso.hojas > QOS_MAX_HOJAS) {
                return problemaTipado(422, 'validacion', 'Datos inválidos', 'El router pasaría del límite de QoS', [{
                    field: 'qos_perfil_id',
                    rule: 'qos_costo',
                    message: `el router pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${uso.hojas})`,
                }])
            }
        }
        Object.assign(router, { qos_perfil_id: perfilId, version: router.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'qos.gestionar', { tipo: 'router', id: router.id }, cuerpo)
        return { status: 200, cuerpo: router }
    }),
}
