import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import {
    columnasPlan,
    verImplementacion,
    verPlan,
    type PlanRouterVista,
    type PlanVista,
} from '#network/consultas/planes'
import { rateLimitServicio, velocidadEfectiva, type VelocidadPlan } from '#network/velocidad'

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
    /**
     * `Mikrotik-Rate-Limit` completo en estado activo (`rateLimitServicio` de
     * `app/network/velocidad.ts`): override del router o `rx/tx ráfaga umbral tiempo prioridad limit-at`
     */
    rate_limit: string
    /** `Mikrotik-Rate-Limit` completo en estado `limitado` (sin ráfaga) */
    rate_limit_limitado: string
    profile_ppp: string | null
    pool_ipv4: string | null
    pool_ipv6_enlace: string | null
    pool_ipv6_delegacion: string | null
    local_address: string | null
    no_crear_reglas: boolean
}

/** Velocidad efectiva (plan + excepciones del router), entrada de `rateLimitServicio`. */
export function velocidadDePlan(plan: PlanVista, implementacion: PlanRouterVista | null): VelocidadPlan {
    return velocidadEfectiva(
        {
            bajada_kbps: plan.bajada_kbps,
            subida_kbps: plan.subida_kbps,
            bajada_limitada_kbps: plan.bajada_limitada_kbps,
            subida_limitada_kbps: plan.subida_limitada_kbps,
            reuso: plan.reuso,
            garantizado_pct: plan.garantizado_pct,
            rafaga_bajada_kbps: plan.rafaga_bajada_kbps,
            rafaga_subida_kbps: plan.rafaga_subida_kbps,
            rafaga_umbral_pct: plan.rafaga_umbral_pct,
            rafaga_segundos: plan.rafaga_segundos,
            prioridad: plan.prioridad,
            rate_limit_override: implementacion?.rate_limit_override ?? null,
        },
        implementacion,
    )
}

/**
 * Los campos de velocidad del resultado ya son los efectivos en el router (`reuso`, `garantizado_pct`,
 * `rafaga_*`, `prioridad` con las excepciones aplicadas); la fila cruda sigue en `implementacion`.
 */
export function componerPlanEfectivo(
    plan: PlanVista,
    routerId: number,
    implementacion: PlanRouterVista | null,
): PlanEfectivo {
    const efectiva = velocidadDePlan(plan, implementacion)
    const { rate_limit_override: override, ...velocidad } = efectiva
    void override
    return {
        ...plan,
        ...velocidad,
        router_id: routerId,
        implementacion,
        rate_limit: rateLimitServicio(efectiva, 'activo'),
        rate_limit_limitado: rateLimitServicio(efectiva, 'limitado'),
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
 * `plan_no_disponible` si no es global ni tiene implementación en ese router (salvo
 * `aunqueNoDisponible`: un servicio que ya tiene el plan lo conserva aunque deje de ofrecerse).
 */
export async function obtenerImplementacionPlan(
    planId: number,
    routerId: number,
    cliente: QueryClientContract = db.connection(),
    opciones: { aunqueNoDisponible?: boolean } = {},
): Promise<PlanEfectivo> {
    const plan = await verPlan(planId, cliente)
    const implementacion = await verImplementacion(planId, routerId, cliente)
    if (!plan.global && !implementacion && !opciones.aunqueNoDisponible) {
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
        .select(columnasPlan('p'))) as PlanVista[]
    const resultado: PlanEfectivo[] = []
    for (const plan of planes) {
        resultado.push(componerPlanEfectivo(plan, routerId, await verImplementacion(plan.id, routerId)))
    }
    return resultado
}
