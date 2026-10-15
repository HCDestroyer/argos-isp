/**
 * Forma del servicio que `aaa` necesita para autorizar. Es el contrato con A1: el mismo JSON se
 * guarda en Redis (`aaa:user:<user_ppp>`) y lo devuelve `GET /internal/aaa/servicio?user_ppp=`.
 * Detalle y ejemplos en `.claude/INTEGRATION.md` y `services/aaa/README.md`.
 */

export const ESTADOS = ['activo', 'limitado', 'suspendido', 'retirado'] as const
export type EstadoServicio = (typeof ESTADOS)[number]

export interface PlanAaa {
    id: number
    subida_kbps: number
    bajada_kbps: number
    subida_limitada_kbps: number
    bajada_limitada_kbps: number
    /** `planes_routers.rate_limit_override`: cadena RouterOS completa (con burst) o null. */
    rate_limit_override: string | null
    /** `planes_routers.profile_ppp`: perfil PPP del router para este plan (→ `Mikrotik-Group`) o null. */
    profile_ppp: string | null
}

export type Ipv4Aaa = { modo: 'estatico'; ip: string } | { modo: 'pool'; pool: string } | null

export type Ipv6Aaa =
    | { modo: 'radius_servicio'; prefijo_enlace: string | null; prefijo_delegado: string | null }
    | { modo: 'radius_pool'; pool_enlace: string | null; pool_delegacion: string | null }
    | { modo: 'duid' | 'estatico' | 'ninguno' }

export interface ServicioAaa {
    servicio_id: number
    /** `core.servicios.version`; solo diagnóstico. */
    version: number
    user_ppp: string
    /** Cifrada con el formato `v1` de `cifrado.ts`. Nunca en claro. */
    pass_ppp: string
    estado: EstadoServicio
    router_id: number
    plan: PlanAaa
    ipv4: Ipv4Aaa
    ipv6: Ipv6Aaa
}

/**
 * Lápida: A1 la escribe en `aaa:user:<user_ppp>` cuando el servicio se borra o cambia de
 * `user_ppp`, para que ningún nodo vuelva a cachear el usuario viejo. Se trata como inexistente.
 */
export interface LapidaAaa {
    eliminado: true
    user_ppp: string
}

export type RegistroAaa = ServicioAaa | LapidaAaa

export class ErrorContrato extends Error {}

type Obj = Record<string, unknown>

function esObj(v: unknown): v is Obj {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function entero(o: Obj, campo: string, ruta: string): number {
    const v = o[campo]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        throw new ErrorContrato(`${ruta}${campo} debe ser entero >= 0`)
    return v
}

function texto(o: Obj, campo: string, ruta: string): string {
    const v = o[campo]
    if (typeof v !== 'string' || v === '') throw new ErrorContrato(`${ruta}${campo} debe ser texto no vacío`)
    return v
}

function textoONulo(o: Obj, campo: string, ruta: string): string | null {
    const v = o[campo]
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') throw new ErrorContrato(`${ruta}${campo} debe ser texto o null`)
    return v
}

function ipv4(v: unknown): Ipv4Aaa {
    if (v === null || v === undefined) return null
    if (!esObj(v)) throw new ErrorContrato('ipv4 debe ser objeto o null')
    if (v.modo === 'estatico') return { modo: 'estatico', ip: texto(v, 'ip', 'ipv4.') }
    if (v.modo === 'pool') return { modo: 'pool', pool: texto(v, 'pool', 'ipv4.') }
    throw new ErrorContrato('ipv4.modo debe ser estatico o pool')
}

function ipv6(v: unknown): Ipv6Aaa {
    if (v === null || v === undefined) return { modo: 'ninguno' }
    if (!esObj(v)) throw new ErrorContrato('ipv6 debe ser objeto o null')
    switch (v.modo) {
        case 'radius_servicio':
            return {
                modo: 'radius_servicio',
                prefijo_enlace: textoONulo(v, 'prefijo_enlace', 'ipv6.'),
                prefijo_delegado: textoONulo(v, 'prefijo_delegado', 'ipv6.'),
            }
        case 'radius_pool':
            return {
                modo: 'radius_pool',
                pool_enlace: textoONulo(v, 'pool_enlace', 'ipv6.'),
                pool_delegacion: textoONulo(v, 'pool_delegacion', 'ipv6.'),
            }
        case 'duid':
        case 'estatico':
        case 'ninguno':
            return { modo: v.modo }
        default:
            throw new ErrorContrato('ipv6.modo inválido')
    }
}

/** Valida el JSON que llega de Redis o de la API. Lanza `ErrorContrato` si no cumple. */
export function parsearRegistro(v: unknown): RegistroAaa {
    if (!esObj(v)) throw new ErrorContrato('el registro debe ser un objeto')
    if (v.eliminado === true) return { eliminado: true, user_ppp: texto(v, 'user_ppp', '') }

    const estado = v.estado
    if (typeof estado !== 'string' || !(ESTADOS as readonly string[]).includes(estado)) {
        throw new ErrorContrato(`estado debe ser uno de ${ESTADOS.join(', ')}`)
    }
    const plan = v.plan
    if (!esObj(plan)) throw new ErrorContrato('plan debe ser objeto')

    return {
        servicio_id: entero(v, 'servicio_id', ''),
        version: entero(v, 'version', ''),
        user_ppp: texto(v, 'user_ppp', ''),
        pass_ppp: texto(v, 'pass_ppp', ''),
        estado: estado as EstadoServicio,
        router_id: entero(v, 'router_id', ''),
        plan: {
            id: entero(plan, 'id', 'plan.'),
            subida_kbps: entero(plan, 'subida_kbps', 'plan.'),
            bajada_kbps: entero(plan, 'bajada_kbps', 'plan.'),
            subida_limitada_kbps: entero(plan, 'subida_limitada_kbps', 'plan.'),
            bajada_limitada_kbps: entero(plan, 'bajada_limitada_kbps', 'plan.'),
            rate_limit_override: textoONulo(plan, 'rate_limit_override', 'plan.'),
            profile_ppp: textoONulo(plan, 'profile_ppp', 'plan.'),
        },
        ipv4: ipv4(v.ipv4),
        ipv6: ipv6(v.ipv6),
    }
}

export function esLapida(r: RegistroAaa): r is LapidaAaa {
    return 'eliminado' in r
}
