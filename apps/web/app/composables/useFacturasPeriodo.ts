import type { Schema, paths } from '@argosisp/contracts'

export type PeriodosFacturables = Schema<'PeriodosFacturables'>
export type PeriodoFacturable = Schema<'PeriodoFacturable'>
export type EstadoPeriodoFacturable = PeriodoFacturable['estado']
export type MotivoNoEmitible = NonNullable<PeriodosFacturables['motivo']>
export type FacturasPeriodoEmitidas = Schema<'FacturasPeriodoEmitidas'>
export type CuerpoFacturasPeriodo = paths['/api/v1/servicios/{id}/facturas-periodo']['post']['requestBody']['content']['application/json']

/**
 * Facturas de periodo emitidas a mano (A3, pedido del PM del 19 nov): pago por adelantado (hasta 12
 * periodos futuros) y periodos que el cron no emitió. La vista previa y la emisión ven los mismos
 * periodos; lo ya emitido o bonificado nunca se duplica.
 */
export function useFacturasPeriodo() {
    const api = useApi()

    /** `GET /servicios/:id/periodos-facturables` (`facturas.ver`): sin `hasta`, hasta el 12.º futuro. */
    function periodos(servicioId: number, hasta?: string): Promise<Resultado<PeriodosFacturables>> {
        return resolver(api.GET('/api/v1/servicios/{id}/periodos-facturables', {
            params: { path: { id: servicioId }, query: hasta ? { hasta } : {} },
        }))
    }

    /** `POST /servicios/:id/facturas-periodo` (`facturas.emitir_periodos`, `Idempotency-Key`). */
    function emitir(servicioId: number, cuerpo: CuerpoFacturasPeriodo, claveIdempotencia: string): Promise<Resultado<FacturasPeriodoEmitidas>> {
        return resolver(api.POST('/api/v1/servicios/{id}/facturas-periodo', {
            params: { path: { id: servicioId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    return { periodos, emitir }
}
