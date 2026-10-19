import type { Schema, paths } from '@argosisp/contracts'

export type LiquidacionCobro = Schema<'LiquidacionCobro'>
export type ResumenCobrosPorLiquidar = Schema<'ResumenCobrosPorLiquidar'>
export type PagoPorLiquidar = Schema<'PagoPorLiquidar'>
export type DatosLiquidacion = paths['/api/v1/cobros/liquidaciones']['post']['requestBody']['content']['application/json']
export type FiltrosLiquidaciones = Omit<NonNullable<paths['/api/v1/cobros/liquidaciones']['get']['parameters']['query']>, 'cursor'>

/**
 * Cobros por liquidar y liquidaciones de los proveedores de cobro (A3, fase 4 §10.3). La
 * liquidación lleva el bruto al banco por el neto y la comisión a `5.1.02`; un pago se liquida una
 * sola vez y los contracargos (pagos liquidados y luego anulados) se descuentan en la siguiente.
 */
export function useLiquidaciones() {
    const api = useApi()

    /** `GET /cobros/por-liquidar` (`bancos.ver`): por proveedor, saldo del puente vs pendiente y anomalías. */
    function porLiquidar(): Promise<Resultado<ResumenCobrosPorLiquidar[]>> {
        return resolver(api.GET('/api/v1/cobros/por-liquidar'))
    }

    function listar(filtros: FiltrosLiquidaciones = {}, cursor?: string): Promise<Resultado<Pagina<LiquidacionCobro>>> {
        const query: FiltrosLiquidaciones & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cobros/liquidaciones', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<LiquidacionCobro>> {
        return resolver(api.GET('/api/v1/cobros/liquidaciones/{id}', { params: { path: { id } } }))
    }

    /**
     * `POST /cobros/liquidaciones` (`cobros.liquidar`): 422 `liquidacion_descuadrada` (bruto ≠
     * Σ pagos − contracargos), 409 `pago_ya_liquidado` y `liquidacion_duplicada`.
     */
    function registrar(datos: DatosLiquidacion, claveIdempotencia: string): Promise<Resultado<LiquidacionCobro>> {
        return resolver(api.POST('/api/v1/cobros/liquidaciones', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { porLiquidar, listar, ver, registrar }
}
