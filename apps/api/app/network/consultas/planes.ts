import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Lecturas de planes y de su implementación por router (`network.planes_routers`).
 */

export interface PlanVista {
    id: number
    nombre: string
    /** numeric(14,2) como string: "150.00" */
    precio: string
    bajada_kbps: number
    subida_kbps: number
    bajada_limitada_kbps: number
    subida_limitada_kbps: number
    reuso: number
    dual_stack: 'ambos' | 'v4' | 'v6'
    tamano_prefijo_delegado: 64 | 56 | 48
    global: boolean
    activo: boolean
    version: number
    created_at: string
    updated_at: string
}

export interface PlanRouterVista {
    id: number
    plan_id: number
    router_id: number
    profile_ppp: string | null
    pool_ipv4: string | null
    pool_ipv6_enlace: string | null
    pool_ipv6_delegacion: string | null
    local_address: string | null
    no_crear_reglas: boolean
    rate_limit_override: string | null
    version: number
    created_at: string
    updated_at: string
}

export const COLUMNAS_PLAN = [
    'id',
    'nombre',
    'precio',
    'bajada_kbps',
    'subida_kbps',
    'bajada_limitada_kbps',
    'subida_limitada_kbps',
    'reuso',
    'dual_stack',
    'tamano_prefijo_delegado',
    'global',
    'activo',
    'version',
    'created_at',
    'updated_at',
]

const COLUMNAS_PLAN_ROUTER = [
    'id',
    'plan_id',
    'router_id',
    'profile_ppp',
    'pool_ipv4',
    'pool_ipv6_enlace',
    'pool_ipv6_delegacion',
    db.raw('host(local_address) AS local_address'),
    'no_crear_reglas',
    'rate_limit_override',
    'version',
    'created_at',
    'updated_at',
]

export interface FiltrosPlanes extends OpcionesPaginacion {
    activo?: boolean
    /** solo planes disponibles en ese router (globales o con implementación) */
    router_id?: number
}

export async function listarPlanes(filtros: FiltrosPlanes): Promise<Pagina<PlanVista>> {
    const consulta = db.from('network.planes as p').select(COLUMNAS_PLAN.map((c) => `p.${c}`))
    if (filtros.activo !== undefined) consulta.where('p.activo', filtros.activo)
    if (filtros.router_id) {
        const routerId = filtros.router_id
        consulta.where((q) =>
            q
                .where('p.global', true)
                .orWhereExists((s) =>
                    s
                        .from('network.planes_routers as pr')
                        .whereRaw('pr.plan_id = p.id')
                        .where('pr.router_id', routerId),
                ),
        )
    }
    return paginar<PlanVista>(consulta, filtros, { columna: 'p.id' })
}

export async function verPlan(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlanVista> {
    const fila = (await cliente
        .from('network.planes')
        .where('id', id)
        .select(COLUMNAS_PLAN)
        .first()) as PlanVista | null
    if (!fila) throw new NoEncontrado(`El plan ${id} no existe`)
    return fila
}

export async function implementacionesDePlan(planId: number): Promise<PlanRouterVista[]> {
    await verPlan(planId)
    return (await db
        .from('network.planes_routers')
        .where('plan_id', planId)
        .orderBy('router_id')
        .select(COLUMNAS_PLAN_ROUTER)) as PlanRouterVista[]
}

export async function verImplementacion(
    planId: number,
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlanRouterVista | null> {
    return (await cliente
        .from('network.planes_routers')
        .where({ plan_id: planId, router_id: routerId })
        .select(COLUMNAS_PLAN_ROUTER)
        .first()) as PlanRouterVista | null
}
