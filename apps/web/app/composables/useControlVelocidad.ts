import type { CambioEstrategiaPlan, CambioEstrategiaRouter, DatosVistaPreviaEstrategia, MatrizControlVelocidad, SincronizacionPlan, VistaPreviaEstrategia, VistaPreviaReconciliar } from '~/types/controlVelocidad'

/**
 * Control de velocidad por capas, «Sincronizar plan» y la vista previa de «Reconciliar ahora»
 * (`contratos/control-velocidad.md` §9, A2). Todo tipado desde `packages/contracts`. La
 * reconciliación en sí es `useRouters().reconciliar` (202, `ReconciliacionEncolada`) y el chequeo
 * del corte llega dentro de «Probar conexión» (`ChequeoConexion.corte`).
 */
export function useControlVelocidad() {
    const api = useApi()

    /** `GET /red/control-velocidad/matriz` (`routers.ver`): qué combina con qué, reglas y atajos. */
    function matriz(): Promise<Resultado<MatrizControlVelocidad>> {
        return resolver(api.GET('/api/v1/red/control-velocidad/matriz'))
    }

    /**
     * `POST /routers/:id/vista-previa-estrategia` (`routers.cambiar_control_velocidad`): no escribe.
     * Con `planes`, las excepciones de esos planes en el router (cambio por lotes). 422 con
     * `errors[].field` = `estrategia_velocidad.<tipo>.<capa>` o `planes.<id>.<tipo>.<capa>`.
     */
    function vistaPrevia(routerId: number, datos: DatosVistaPreviaEstrategia): Promise<Resultado<VistaPreviaEstrategia>> {
        return resolver(api.POST('/api/v1/routers/{id}/vista-previa-estrategia', { params: { path: { id: routerId } }, body: datos }))
    }

    /** `POST /routers/:id/cambiar-estrategia-velocidad` con `version` (409 si cambió). */
    function cambiarRouter(routerId: number, datos: CambioEstrategiaRouter): Promise<Resultado<RouterNas>> {
        return resolver(api.POST('/api/v1/routers/{id}/cambiar-estrategia-velocidad', { params: { path: { id: routerId } }, body: datos }))
    }

    /** `POST /planes/:id/routers/:routerId/estrategia-velocidad`: excepción del plan en el router (null = hereda). */
    function cambiarPlan(planId: number, routerId: number, datos: CambioEstrategiaPlan): Promise<Resultado<PlanRouter>> {
        return resolver(api.POST('/api/v1/planes/{id}/routers/{routerId}/estrategia-velocidad', { params: { path: { id: planId, routerId } }, body: datos }))
    }

    /** `POST /planes/:id/sincronizar?router_id=` (`planes.sincronizar`): CoA a las sesiones vivas y reconciliación. */
    function sincronizar(planId: number, routerId: number | null, claveIdempotencia: string): Promise<Resultado<SincronizacionPlan>> {
        return resolver(api.POST('/api/v1/planes/{id}/sincronizar', {
            params: { path: { id: planId }, query: routerId ? { router_id: routerId } : {}, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `GET /routers/:id/vista-previa-reconciliar` (`routers.reconciliar`): lee el router, no escribe. */
    function vistaPreviaReconciliar(routerId: number): Promise<Resultado<VistaPreviaReconciliar>> {
        return resolver(api.GET('/api/v1/routers/{id}/vista-previa-reconciliar', { params: { path: { id: routerId } } }))
    }

    return { matriz, vistaPrevia, cambiarRouter, cambiarPlan, sincronizar, vistaPreviaReconciliar }
}
