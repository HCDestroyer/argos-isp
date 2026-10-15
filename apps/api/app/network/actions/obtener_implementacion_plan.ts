import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import {
    COLUMNAS_PLAN,
    verImplementacion,
    verPlan,
    type PlanRouterVista,
    type PlanVista,
} from '#network/consultas/planes'

/**
 * Interfaz pública de A1 (solo lectura, sin auditoría): configuración efectiva de un plan en un
 * router = plantilla del plan + excepciones de `network.planes_routers` para ese router.
 *
 * Un plan está disponible en un router si es `global` o si tiene implementación en ese router.
 * La usan `crearServicio`/`editarServicio`, la pantalla de planes por router y el armado del
 * payload de RADIUS (tarea 9).
 */

export interface PlanEfectivo extends PlanVista {
    router_id: number
    /** fila de `planes_routers` (null si el plan es global y no tiene excepciones en el router) */
    implementacion: PlanRouterVista | null
    /** rate-limit de MikroTik `subida/bajada` (rx/tx del cliente): override o `<subida>k/<bajada>k` */
    rate_limit: string
    /** rate-limit en estado `limitado` */
    rate_limit_limitado: string
    profile_ppp: string | null
    pool_ipv4: string | null
    pool_ipv6_enlace: string | null
    pool_ipv6_delegacion: string | null
    local_address: string | null
    no_crear_reglas: boolean
}

export function componerPlanEfectivo(
    plan: PlanVista,
    routerId: number,
    implementacion: PlanRouterVista | null,
): PlanEfectivo {
    return {
        ...plan,
        router_id: routerId,
        implementacion,
        rate_limit: implementacion?.rate_limit_override ?? `${plan.subida_kbps}k/${plan.bajada_kbps}k`,
        rate_limit_limitado: `${plan.subida_limitada_kbps}k/${plan.bajada_limitada_kbps}k`,
        profile_ppp: implementacion?.profile_ppp ?? null,
        pool_ipv4: implementacion?.pool_ipv4 ?? null,
        pool_ipv6_enlace: implementacion?.pool_ipv6_enlace ?? null,
        pool_ipv6_delegacion: implementacion?.pool_ipv6_delegacion ?? null,
        local_address: implementacion?.local_address ?? null,
        no_crear_reglas: implementacion?.no_crear_reglas ?? false,
    }
}

/**
 * Configuración efectiva del plan en el router. 404 si el plan no existe; 422
 * `plan_no_disponible` si no es global ni tiene implementación en ese router.
 */
export async function obtenerImplementacionPlan(
    planId: number,
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlanEfectivo> {
    const plan = await verPlan(planId, cliente)
    const implementacion = await verImplementacion(planId, routerId, cliente)
    if (!plan.global && !implementacion) {
        throw new ReglaNegocio(
            `El plan ${plan.nombre} no está disponible en el router ${routerId}`,
            'plan_no_disponible',
        )
    }
    return componerPlanEfectivo(plan, routerId, implementacion)
}

/** Planes disponibles (y activos) en un router, con su configuración efectiva. */
export async function planesDisponiblesEnRouter(routerId: number): Promise<PlanEfectivo[]> {
    const router = await db.from('network.routers').where('id', routerId).select('id').first()
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const planes = (await db
        .from('network.planes as p')
        .where('p.activo', true)
        .where((q) =>
            q
                .where('p.global', true)
                .orWhereExists((s) =>
                    s
                        .from('network.planes_routers as pr')
                        .whereRaw('pr.plan_id = p.id')
                        .where('pr.router_id', routerId),
                ),
        )
        .orderBy('p.nombre')
        .select(COLUMNAS_PLAN.map((c) => `p.${c}`))) as PlanVista[]
    const resultado: PlanEfectivo[] = []
    for (const plan of planes) {
        resultado.push(componerPlanEfectivo(plan, routerId, await verImplementacion(plan.id, routerId)))
    }
    return resultado
}
