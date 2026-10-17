import type { Schema, paths } from '@argosisp/contracts'

export type Factura = Schema<'Factura'>
export type FacturaDetalle = Schema<'FacturaDetalle'>
export type FacturaLinea = Schema<'FacturaLinea'>
export type NotaCredito = Schema<'NotaCredito'>
export type NotaCreditoEmitida = Schema<'NotaCreditoEmitida'>
export type DatosNotaCredito = paths['/api/v1/facturas/{id}/notas-credito']['post']['requestBody']['content']['application/json']
export type FiltrosNotasCredito = Omit<NonNullable<paths['/api/v1/notas-credito']['get']['parameters']['query']>, 'cursor'>
export type FiltrosFacturas = Omit<NonNullable<paths['/api/v1/facturas']['get']['parameters']['query']>, 'cursor'>

export const LIMITE_FACTURAS = 25

/** Facturas (avisos de cobro): lista con filtros, detalle con líneas y anulación con motivo. */
export function useFacturas() {
    const api = useApi()

    function listar(filtros: FiltrosFacturas = {}, cursor?: string): Promise<Resultado<Pagina<Factura>>> {
        const query: FiltrosFacturas & { cursor?: string } = { limit: LIMITE_FACTURAS, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/facturas', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<FacturaDetalle>> {
        return resolver(api.GET('/api/v1/facturas/{id}', { params: { path: { id } } }))
    }

    /** `POST /facturas/:id/anular` con motivo (`facturas.anular`): la API revierte su asiento. */
    function anular(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Factura>> {
        return resolver(api.POST('/api/v1/facturas/{id}/anular', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /**
     * `POST /facturas/:id/notas-credito` (`facturas.nota_credito`): nota de crédito interna, parcial o
     * total, sobre el saldo. Devuelve la factura con su nuevo saldo y `servicios[]` (reactivación).
     * 422 `monto` si excede el saldo; 409 `factura_anulada` o `factura_sin_saldo`.
     */
    function notaCredito(id: number, datos: DatosNotaCredito, claveIdempotencia: string): Promise<Resultado<NotaCreditoEmitida>> {
        return resolver(api.POST('/api/v1/facturas/{id}/notas-credito', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `GET /notas-credito` (`facturas.ver`) por cliente, factura o fecha contable. */
    function notasCredito(filtros: FiltrosNotasCredito = {}, cursor?: string): Promise<Resultado<Pagina<NotaCredito>>> {
        const query: FiltrosNotasCredito & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/notas-credito', { params: { query } }))
    }

    return { listar, ver, anular, notaCredito, notasCredito }
}
