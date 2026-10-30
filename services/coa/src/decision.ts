import type { PerfilSuspendido } from './config.ts'

/**
 * Qué mandar al NAS por cada evento. Función pura: no decide estados (eso es de billing/núcleo),
 * solo traduce el cambio que ya ocurrió a CoA o Disconnect.
 *
 * Decisión del PM, probada en RouterOS 7.24.5 (`infra/mikrotik/README.md`):
 *
 * | Cambio                                   | Paquete    | Atributos                                                      |
 * | ---------------------------------------- | ---------- | -------------------------------------------------------------- |
 * | → `suspendido`                           | CoA        | `Mikrotik-Rate-Limit` mínimo, `Mikrotik-Address-List`, `Filter-Id` |
 * | `activo` → `limitado`                    | CoA        | `Mikrotik-Rate-Limit` limitado                                  |
 * | `limitado` → `activo`                    | CoA        | `Mikrotik-Rate-Limit` del plan                                  |
 * | `suspendido` → `activo` o `limitado`     | Disconnect | (un CoA no quita el corte IPv6; al reconectar `aaa` da el perfil) |
 * | → `retirado`                             | Disconnect | (al reconectar `aaa` lo rechaza)                                |
 * | `pendiente_instalacion` → `activo`       | Disconnect | (sin sesión no se envía nada: `aaa` rechazaba al pendiente)     |
 * | config: `ips`, `prefijo_v6` o `router`   | Disconnect | (al reconectar trae la IP, el prefijo o el NAS nuevos)          |
 * | config: `router` con `union_routers`     | nada       | (mismo equipo físico: la sesión sigue; `contratos/routers.md`)  |
 * | config: solo `plan`                      | CoA        | `Mikrotik-Rate-Limit` del estado actual (nada si suspendido)    |
 * | config: `plan` con reuso > 1 (`simple`)  | Disconnect | (al reconectar entra al perfil `plan-<id>` con su cola padre)   |
 * | velocidad o plan en `arbol_pcq`          | nada       | (sin cola por sesión: el dispatcher mueve la lista del plan)    |
 *
 * El rate-limit es siempre la cadena completa de A1 (`registro.ts`); si no se puede leer, el CoA
 * de velocidad se registra como fallido (`coa.fallido`) en vez de mandar uno distinto.
 *
 * Un `servicio.estado_cambiado` cuyo `a` ya no es el estado actual se ignora: llegó tarde y otro
 * evento posterior describe el estado vigente (el relay entrega al menos una vez y en orden, pero
 * un reintento puede llegar después).
 */

/**
 * `pendiente_instalacion` (`contratos/instalacion.md`): solo sale a `activo` (`motivo: instalacion`)
 * o a `retirado`. `aaa` lo rechaza, así que no tiene sesión; si quedara una (RADIUS anterior a la
 * migración), el Disconnect la hace reconectar con el perfil del estado nuevo.
 */
export type EstadoServicio = 'pendiente_instalacion' | 'activo' | 'limitado' | 'suspendido' | 'retirado'
export const ESTADOS: readonly EstadoServicio[] = [
    'pendiente_instalacion',
    'activo',
    'limitado',
    'suspendido',
    'retirado',
]

export type CampoConfig = 'plan' | 'ips' | 'prefijo_v6' | 'router'

/** `servicio.config_cambiada` de `routers.unir` (A1, `contratos/routers.md`) */
export const MOTIVO_UNION_ROUTERS = 'union_routers'

export type EventoServicio =
    | {
          evento: 'servicio.estado_cambiado'
          servicio_id: number
          de: EstadoServicio
          a: EstadoServicio
          motivo?: string
      }
    | {
          evento: 'servicio.config_cambiada'
          servicio_id: number
          campos: CampoConfig[]
          /** `union_routers`: el servicio pasó al otro registro del mismo MikroTik (`routers.unir`) */
          motivo?: string
      }

/** Lo que hay que saber del servicio hoy (Postgres + registro de `aaa`, ver `registro.ts`). */
export interface ServicioActual {
    servicio_id: number
    estado: EstadoServicio
    /**
     * Cadenas completas de `Mikrotik-Rate-Limit` que calcula A1 (`apps/api/app/network/velocidad.ts`)
     * y publica en `aaa:user:<user_ppp>` y en `GET /internal/aaa/servicio`: las mismas que entrega
     * `aaa` al conectar (`rate_limit` ya incluye `rate_limit_override`). null si no se pudieron leer
     * o el servicio no las necesita (suspendido, retirado, sin PPPoE).
     */
    rate_limit: string | null
    rate_limit_limitado: string | null
    /** Por qué faltan las cadenas (Redis y API sin respuesta); el CoA de velocidad falla con esto. */
    error_rate_limit?: string | null
    /** Del mismo registro: reuso efectivo del plan y `control_velocidad` del router */
    reuso?: number
    control_velocidad?: 'simple' | 'arbol_pcq'
    /**
     * Estrategia por capas del registro (`contratos/control-velocidad.md` §7): `aplicacion` y el
     * `Mikrotik-Group` que entrega `aaa`. null/ausente en registros anteriores (se usa lo de arriba).
     */
    aplicacion?: string | null
    grupo?: string | null
}

/** Sin cola por sesión: la velocidad la pone el PCQ del plan (cola o árbol), no un CoA. */
function sinColaPorSesion(servicio: ServicioActual): boolean {
    if (servicio.aplicacion) return servicio.aplicacion === 'arbol_pcq' || servicio.aplicacion === 'pcq_plan'
    return servicio.control_velocidad === 'arbol_pcq'
}

/** El perfil PPP depende del plan (`plan-<id>`): solo se asigna al conectar. */
function perfilDelPlan(servicio: ServicioActual): boolean {
    if (servicio.aplicacion) return Boolean(servicio.grupo?.startsWith('plan-'))
    return servicio.control_velocidad === 'simple' && (servicio.reuso ?? 1) > 1
}

export type AtributosCoa = Record<string, string>

export type Decision =
    | {
          accion: 'coa'
          atributos: AtributosCoa
          razon: string
          /** CoA de suspensión (perfil de corte); el dispatcher puede cambiarlo por Disconnect en IPv6 */
          suspender?: true
          /** No se pudo armar el CoA (falta el rate-limit de A1): se registra el fallo sin enviar. */
          error?: string
      }
    | { accion: 'disconnect'; razon: string }
    | { accion: 'nada'; razon: string }

/**
 * Rate-limit del estado actual, tal cual lo publica A1 (igual que `services/aaa/src/perfil.ts`).
 * Nunca se arma uno propio: sin las cadenas devuelve null y el CoA falla con `coa.fallido`.
 */
export function rateLimitDe(servicio: ServicioActual): string | null {
    switch (servicio.estado) {
        case 'activo':
            return servicio.rate_limit
        case 'limitado':
            return servicio.rate_limit_limitado
        default:
            return null
    }
}

/** CoA de velocidad del estado actual, o el error si no hay cadena de A1. */
function coaVelocidad(servicio: ServicioActual, razon: string): Decision {
    if (sinColaPorSesion(servicio)) {
        // Sin cola por sesión: el dispatcher de RouterOS mueve sus direcciones entre las listas o
        // colas del plan.
        return {
            accion: 'nada',
            razon: `${razon}: ${servicio.aplicacion ?? 'arbol_pcq'} (lo aplica el dispatcher de RouterOS)`,
        }
    }
    const rate = rateLimitDe(servicio)
    if (!rate) {
        return {
            accion: 'coa',
            razon,
            atributos: {},
            error:
                servicio.error_rate_limit || `sin rate-limit de A1 para el servicio ${servicio.servicio_id}`,
        }
    }
    return { accion: 'coa', razon, atributos: { 'Mikrotik-Rate-Limit': rate } }
}

export function decidir(
    evento: EventoServicio,
    servicio: ServicioActual | null,
    suspendido: PerfilSuspendido,
): Decision {
    if (evento.evento === 'servicio.estado_cambiado') {
        if (!servicio) {
            return { accion: 'nada', razon: 'servicio inexistente' }
        }
        if (servicio.estado !== evento.a) {
            return { accion: 'nada', razon: `evento superado: el servicio ya está ${servicio.estado}` }
        }
        if (evento.a === evento.de) return { accion: 'nada', razon: 'sin cambio de estado' }
        if (evento.a === 'retirado') return { accion: 'disconnect', razon: 'retirado' }
        if (evento.de === 'pendiente_instalacion') {
            return {
                accion: 'disconnect',
                razon: `instalación activada: pendiente_instalacion → ${evento.a}`,
            }
        }
        if (evento.de === 'suspendido') {
            return { accion: 'disconnect', razon: `reactivar: suspendido → ${evento.a}` }
        }
        if (evento.a === 'suspendido') {
            return {
                accion: 'coa',
                razon: `suspender: ${evento.de} → suspendido`,
                suspender: true,
                atributos: {
                    'Mikrotik-Rate-Limit': suspendido.rateLimit,
                    'Mikrotik-Address-List': suspendido.addressList,
                    'Filter-Id': suspendido.filterId,
                },
            }
        }
        return coaVelocidad(servicio, `velocidad: ${evento.de} → ${evento.a}`)
    }

    const campos = new Set(evento.campos)
    // Unión de routers (`routers.unir`, A1): dos registros del mismo MikroTik. El NAS no cambia, la
    // sesión sigue y A1 reatribuye su accounting al router que queda: no hay nada que cortar.
    if (evento.motivo === MOTIVO_UNION_ROUTERS) campos.delete('router')
    const reconectar = (['ips', 'prefijo_v6', 'router'] as const).filter((c) => campos.has(c))
    if (reconectar.length > 0) return { accion: 'disconnect', razon: `cambió ${reconectar.join(', ')}` }
    if (!campos.has('plan')) {
        return {
            accion: 'nada',
            razon:
                evento.motivo === MOTIVO_UNION_ROUTERS
                    ? 'unión de routers: mismo equipo, la sesión sigue'
                    : 'sin campos que afecten a la sesión',
        }
    }
    if (!servicio) return { accion: 'nada', razon: 'servicio inexistente' }
    if (servicio.estado !== 'activo' && servicio.estado !== 'limitado') {
        return {
            accion: 'nada',
            razon: `plan cambiado con el servicio ${servicio.estado}: se aplica al reconectar`,
        }
    }
    if (perfilDelPlan(servicio)) {
        // El perfil PPP (`Mikrotik-Group = plan-<id>`, con la cola padre) solo se asigna al conectar.
        return {
            accion: 'disconnect',
            razon: 'cambió el plan: reconecta con el perfil plan-<id> y su cola padre',
        }
    }
    return coaVelocidad(servicio, 'cambió el plan')
}

/**
 * Desconexión manual (`POST /sesiones/:id/desconectar`, `POST /servicios/:id/desconectar`): la
 * acción de la API ya decidió; `coa` solo manda el Disconnect-Request a esa sesión si sigue abierta.
 */
export interface EventoDesconexion {
    evento: 'sesion.desconexion_solicitada'
    sesion_id: number
    servicio_id: number | null
    motivo: string
}

/**
 * Cambio de velocidad de una sesión viva (`planes.sincronizar`, `contratos/control-velocidad.md` §5):
 * la API ya calculó el `Mikrotik-Rate-Limit`; `coa` manda un CoA (nunca Disconnect) si la sesión sigue
 * abierta y el servicio sigue en `estado`.
 */
export interface EventoVelocidad {
    evento: 'sesion.velocidad_solicitada'
    sesion_id: number
    servicio_id: number
    estado: 'activo' | 'limitado'
    rate_limit: string
    motivo: string
}

export const EVENTOS_COA = [
    'servicio.estado_cambiado',
    'servicio.config_cambiada',
    'sesion.desconexion_solicitada',
    'sesion.velocidad_solicitada',
] as const

/** Payload que no cumple el catálogo: el consumidor lo confirma y lo descarta (reintentar no sirve). */
export class EventoInvalido extends Error {}

function idPositivo(valor: unknown, campo: string): number {
    const n = Number(valor)
    if (!Number.isSafeInteger(n) || n <= 0) throw new EventoInvalido(`${campo} inválido`)
    return n
}

/** Valida el payload de `sesion.desconexion_solicitada`. */
export function leerDesconexion(payload: unknown): EventoDesconexion {
    if (typeof payload !== 'object' || payload === null) throw new EventoInvalido('payload inválido')
    const p = payload as Record<string, unknown>
    return {
        evento: 'sesion.desconexion_solicitada',
        sesion_id: idPositivo(p.sesion_id, 'sesion_id'),
        servicio_id:
            p.servicio_id === null || p.servicio_id === undefined
                ? null
                : idPositivo(p.servicio_id, 'servicio_id'),
        motivo: typeof p.motivo === 'string' ? p.motivo : '',
    }
}

/** Valida el payload de `sesion.velocidad_solicitada`. */
export function leerVelocidad(payload: unknown): EventoVelocidad {
    if (typeof payload !== 'object' || payload === null) throw new EventoInvalido('payload inválido')
    const p = payload as Record<string, unknown>
    if (p.estado !== 'activo' && p.estado !== 'limitado') throw new EventoInvalido('estado inválido')
    if (typeof p.rate_limit !== 'string' || p.rate_limit.trim() === '') {
        throw new EventoInvalido('rate_limit inválido')
    }
    return {
        evento: 'sesion.velocidad_solicitada',
        sesion_id: idPositivo(p.sesion_id, 'sesion_id'),
        servicio_id: idPositivo(p.servicio_id, 'servicio_id'),
        estado: p.estado,
        rate_limit: p.rate_limit,
        motivo: typeof p.motivo === 'string' ? p.motivo : '',
    }
}

/**
 * Qué hacer con `sesion.velocidad_solicitada`: CoA con el rate-limit del evento, o nada si el servicio
 * ya no está en ese estado (ese cambio trae su propio CoA) o va por PCQ.
 */
export function decidirVelocidad(evento: EventoVelocidad, servicio: ServicioActual | null): Decision {
    if (!servicio) return { accion: 'nada', razon: 'servicio inexistente' }
    if (servicio.estado !== evento.estado) {
        return { accion: 'nada', razon: `evento superado: el servicio ya está ${servicio.estado}` }
    }
    return {
        accion: 'coa',
        razon: evento.motivo ? `velocidad: ${evento.motivo}` : 'velocidad: sincronizar plan',
        atributos: { 'Mikrotik-Rate-Limit': evento.rate_limit },
    }
}

/** Valida el payload que llega por el stream. Devuelve null si el evento no es para `coa`. */
export function leerEvento(nombre: string, payload: unknown): EventoServicio | null {
    if (nombre !== 'servicio.estado_cambiado' && nombre !== 'servicio.config_cambiada') return null
    if (typeof payload !== 'object' || payload === null) throw new EventoInvalido('payload inválido')
    const p = payload as Record<string, unknown>
    const servicioId = Number(p.servicio_id)
    if (!Number.isSafeInteger(servicioId) || servicioId <= 0) throw new EventoInvalido('servicio_id inválido')
    if (nombre === 'servicio.estado_cambiado') {
        const de = p.de as EstadoServicio
        const a = p.a as EstadoServicio
        if (!ESTADOS.includes(de) || !ESTADOS.includes(a)) throw new EventoInvalido('estado inválido')
        return {
            evento: nombre,
            servicio_id: servicioId,
            de,
            a,
            motivo: typeof p.motivo === 'string' ? p.motivo : undefined,
        }
    }
    if (!Array.isArray(p.campos)) throw new EventoInvalido('campos inválido')
    return {
        evento: nombre,
        servicio_id: servicioId,
        campos: p.campos.filter((c): c is CampoConfig =>
            ['plan', 'ips', 'prefijo_v6', 'router'].includes(String(c)),
        ),
        ...(typeof p.motivo === 'string' ? { motivo: p.motivo } : {}),
    }
}
