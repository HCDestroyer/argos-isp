import type { CambioEstrategiaPlan, CambioEstrategiaRouter, DatosVistaPreviaEstrategia, MatrizControlVelocidad, SincronizacionPlan, VistaPreviaEstrategia } from '~/types/controlVelocidad'

/**
 * Control de velocidad por capas y «Sincronizar plan» (`contratos/control-velocidad.md`, A2).
 *
 * PROVISIONAL: estas rutas todavía no están en `packages/contracts` (A2 sube el código en
 * `a2/control-velocidad`). Se llaman con el mismo cliente del panel (cookie, CSRF, canal y empresa)
 * por un tipo mínimo; al regenerar los contratos se pasa a `api.GET/POST` tipados y `Schema<…>`.
 */
interface RespuestaProvisional<T> {
    data?: T
    error?: unknown
    response: Response
}

interface OpcionesProvisionales {
    params?: { path?: Record<string, number>, query?: Record<string, number | string>, header?: Record<string, string> }
    body?: unknown
}

interface ClienteProvisional {
    GET<T>(ruta: string, opciones?: OpcionesProvisionales): Promise<RespuestaProvisional<T>>
    POST<T>(ruta: string, opciones?: OpcionesProvisionales): Promise<RespuestaProvisional<T>>
}

export function useControlVelocidad() {
    const api = useApi() as unknown as ClienteProvisional

    /** `GET /red/control-velocidad/matriz` (`routers.ver`): qué combina con qué. */
    function matriz(): Promise<Resultado<MatrizControlVelocidad>> {
        return resolver(api.GET<MatrizControlVelocidad>('/api/v1/red/control-velocidad/matriz'))
    }

    /** `POST /routers/:id/vista-previa-estrategia` (`routers.cambiar_control_velocidad`): no escribe; 422 con la matriz. */
    function vistaPrevia(routerId: number, datos: DatosVistaPreviaEstrategia): Promise<Resultado<VistaPreviaEstrategia>> {
        return resolver(api.POST<VistaPreviaEstrategia>('/api/v1/routers/{id}/vista-previa-estrategia', { params: { path: { id: routerId } }, body: datos }))
    }

    /** `POST /routers/:id/cambiar-estrategia-velocidad` (`routers.cambiar_control_velocidad`) con `version`; 409 `cambio_en_curso`. */
    function cambiarRouter(routerId: number, datos: CambioEstrategiaRouter): Promise<Resultado<RouterNas>> {
        return resolver(api.POST<RouterNas>('/api/v1/routers/{id}/cambiar-estrategia-velocidad', { params: { path: { id: routerId } }, body: datos }))
    }

    /** `POST /planes/:id/routers/:router_id/estrategia-velocidad`: excepción del plan en el router (null = hereda). */
    function cambiarPlan(planId: number, routerId: number, datos: CambioEstrategiaPlan): Promise<Resultado<PlanRouter>> {
        return resolver(api.POST<PlanRouter>('/api/v1/planes/{id}/routers/{router_id}/estrategia-velocidad', { params: { path: { id: planId, router_id: routerId } }, body: datos }))
    }

    /** `POST /planes/:id/sincronizar?router_id=` (`planes.sincronizar`): CoA a las sesiones vivas y reconciliación. */
    function sincronizar(planId: number, routerId: number | null, claveIdempotencia: string): Promise<Resultado<SincronizacionPlan>> {
        return resolver(api.POST<SincronizacionPlan>('/api/v1/planes/{id}/sincronizar', {
            params: { path: { id: planId }, query: routerId ? { router_id: routerId } : {}, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    return { matriz, vistaPrevia, cambiarRouter, cambiarPlan, sincronizar }
}
