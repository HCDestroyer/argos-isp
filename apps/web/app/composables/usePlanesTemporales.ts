import type { Schema, paths } from '@argosisp/contracts'

export type PlanTemporal = Schema<'PlanTemporal'>
export type DatosPlanTemporal = paths['/api/v1/servicios/{id}/planes-temporales']['post']['requestBody']['content']['application/json']

/**
 * Planes temporales de un servicio (A1): mejoras de plan con fecha de fin, manuales o de un canje
 * de lealtad. Al terminar o cancelar, el servicio vuelve a su plan base.
 */
export function usePlanesTemporales() {
    const api = useApi()

    function listar(servicioId: number, cursor?: string): Promise<Resultado<Pagina<PlanTemporal>>> {
        const query: { limit: number, cursor?: string } = { limit: 20 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/servicios/{id}/planes-temporales', { params: { path: { id: servicioId }, query } }))
    }

    /** `POST …/planes-temporales` (`servicios.programar_plan_temporal`) con `Idempotency-Key`; 409 si ya hay uno activo o programado que choca. */
    function programar(servicioId: number, datos: DatosPlanTemporal, claveIdempotencia: string): Promise<Resultado<PlanTemporal>> {
        return resolver(api.POST('/api/v1/servicios/{id}/planes-temporales', {
            params: { path: { id: servicioId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `POST …/planes-temporales/:id/cancelar` (`servicios.cancelar_plan_temporal`) con `version` y motivo. */
    function cancelar(plan: Pick<PlanTemporal, 'id' | 'servicio_id' | 'version'>, motivo: string, claveIdempotencia: string): Promise<Resultado<PlanTemporal>> {
        return resolver(api.POST('/api/v1/servicios/{id}/planes-temporales/{planTemporalId}/cancelar', {
            params: { path: { id: plan.servicio_id, planTemporalId: plan.id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { version: plan.version, motivo },
        }))
    }

    return { listar, programar, cancelar }
}
