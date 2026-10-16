import type { Schema, paths } from '@argosisp/contracts'

export type Factura = Schema<'Factura'>
export type FacturaDetalle = Schema<'FacturaDetalle'>
export type FacturaLinea = Schema<'FacturaLinea'>
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

    return { listar, ver, anular }
}
