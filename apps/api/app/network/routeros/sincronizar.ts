import type { ContextoAccion } from '#shared/contexto'
import SincronizarPlan, {
    type EntradaSincronizarPlan,
    type SincronizacionPlan,
} from '#network/actions/sincronizar_plan'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { routersConServiciosSinPppoe } from '#network/routeros/consultas'
import type { OpcionesDispatcher } from '#network/routeros/dispatcher'

/**
 * Sincronizar un plan de punta a punta (`POST /planes/:id/sincronizar` y `plan.velocidad_cambiada`):
 *
 * 1. `planes.sincronizar`: CoA de velocidad a las sesiones vivas y `aaa:user:*` reescrito;
 * 2. `routeros.reconciliar` de cada router con API (o con servicios sin PPPoE): colas, padres,
 *    perfiles `plan-<id>` y PCQ. Un router que no responde no frena a los demás: su error va al
 *    resumen (y `routeros.fallido`, como en cualquier reconciliación).
 */
export async function sincronizarPlan(
    entrada: EntradaSincronizarPlan,
    ctx: ContextoAccion,
    opciones: OpcionesDispatcher = {},
): Promise<SincronizacionPlan> {
    const resultado = await new SincronizarPlan().execute(entrada, ctx)
    const conApi = new Set(await routersConServiciosSinPppoe({ planId: entrada.plan_id }))
    for (const router of resultado.routers) {
        if (!conApi.has(router.router_id)) continue
        const r = await new ReconciliarRouterOS(opciones).execute(
            { router_id: router.router_id, motivo: 'plan', evento_id: entrada.evento_id ?? null },
            ctx,
        )
        router.reconciliado = !r.omitido && r.error === null
        router.colas_cambiadas = r.correcciones.length
        if (r.error) router.errores.push(r.error)
        router.errores.push(...r.errores_velocidad)
    }
    return resultado
}
