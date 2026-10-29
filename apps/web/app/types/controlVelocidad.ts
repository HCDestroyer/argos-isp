/**
 * Tipos del control de velocidad por capas (`contratos/control-velocidad.md`, A2).
 *
 * PROVISIONAL: A2 todavía no subió los endpoints, así que `packages/contracts` no los trae. Estos
 * tipos son espejo del contrato y se reemplazan por `Schema<'EstrategiaVelocidad'>`,
 * `Schema<'VistaPreviaEstrategia'>`, `Schema<'SincronizacionPlan'>` y `Schema<'MatrizControlVelocidad'>`
 * en cuanto se regenere `packages/contracts` (pedido en `.claude/integration/a4.md`).
 */

export const APLICACIONES = ['radius_rate_limit', 'perfil_ppp', 'cola_simple', 'pcq_plan', 'arbol_pcq'] as const
export const PADRES = ['ninguno', 'por_plan', 'por_router', 'jerarquico'] as const
export const TIPOS_COLA = ['default', 'sfq', 'fq_codel', 'cake', 'pcq'] as const
export const EXTRAS = ['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack'] as const
export const TIPOS_CONEXION_VELOCIDAD = ['pppoe', 'ip_estatica', 'dhcp_fija'] as const

export type Aplicacion = typeof APLICACIONES[number]
export type Padre = typeof PADRES[number]
export type TipoCola = typeof TIPOS_COLA[number]
export type Extra = typeof EXTRAS[number]
export type TipoConexionVelocidad = typeof TIPOS_CONEXION_VELOCIDAD[number]

export type ExtrasEstrategia = Record<Extra, boolean>

/** Una estrategia completa: las cuatro capas (§1). */
export interface Estrategia {
    aplicacion: Aplicacion
    padre: Padre
    tipo_cola: TipoCola
    extras: ExtrasEstrategia
}

/** Excepción de un plan en un router: cada capa ausente hereda del router (§2). */
export interface EstrategiaParcial {
    aplicacion?: Aplicacion
    padre?: Padre
    tipo_cola?: TipoCola
    extras?: Partial<ExtrasEstrategia>
}

/** `network.routers.estrategia_velocidad`: una estrategia por tipo de conexión. */
export type EstrategiasRouter = Record<TipoConexionVelocidad, Estrategia>

/** `network.planes_routers.estrategia_velocidad`: null o parcial por tipo. */
export type EstrategiasPlan = Partial<Record<TipoConexionVelocidad, EstrategiaParcial>>

/** Campos que la vista `Router` suma con el contrato. */
export interface RouterConEstrategia {
    estrategia_velocidad?: EstrategiasRouter
    routeros_version?: string | null
}

export interface ObjetoRouterOs {
    ruta: string
    clave: string
    nombre: string | null
}

/** `POST /routers/:id/vista-previa-estrategia` (§4). */
export interface VistaPreviaEstrategia {
    router_id: number
    valida: boolean
    errores: { field: string, rule: string, message: string }[]
    advertencias: { regla: string, mensaje: string }[]
    de: EstrategiasRouter
    a: EstrategiasRouter
    crear: ObjetoRouterOs[]
    actualizar: ObjetoRouterOs[]
    borrar: ObjetoRouterOs[]
    menus: { ruta: string, crear: number, actualizar: number, borrar: number }[]
    servicios: number
    lotes: number
    sesiones_coa: number
    sesiones_conservan: number
    sesiones_a_desconectar: number
    orden: string[]
}

export interface DatosVistaPreviaEstrategia {
    estrategia_velocidad?: EstrategiasRouter
    planes?: Record<string, EstrategiasPlan | null>
    reconectar?: boolean
}

export interface CambioEstrategiaRouter {
    version: number
    estrategia_velocidad: EstrategiasRouter
    motivo?: string
    reconectar?: boolean
}

export interface CambioEstrategiaPlan {
    version: number
    estrategia_velocidad: EstrategiasPlan | null
    motivo?: string
    reconectar?: boolean
}

/** `POST /planes/:id/sincronizar` (§5). */
export interface SincronizacionPlan {
    plan_id: number
    aaa_reescritos: number
    routers: {
        router_id: number
        nombre: string
        servicios: number
        sesiones_actualizadas: number
        sesiones_sin_coa: number
        colas_cambiadas: number
        errores: string[]
    }[]
}

/**
 * `GET /red/control-velocidad/matriz` (§3). El contrato no fija la forma: esta es la que el panel
 * propone a A2 (`a4.md`): qué tipos de conexión y tipos de cola admite cada aplicación, su familia,
 * la versión mínima de cada tipo de cola y los mensajes de cada regla.
 */
export interface MatrizControlVelocidad {
    aplicaciones: { valor: Aplicacion, familia: 'simples' | 'arbol', tipos_conexion: TipoConexionVelocidad[], tipos_cola: TipoCola[] }[]
    tipos_cola: { valor: TipoCola, routeros_minimo: number | null }[]
    padres: { valor: Padre }[]
    reglas: { rule: string, mensaje: string }[]
}
