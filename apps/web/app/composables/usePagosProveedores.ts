import type { Schema, paths } from '@argosisp/contracts'

export type PagoProveedor = Schema<'PagoProveedor'>
export type FiltrosPagosProveedores = Omit<NonNullable<paths['/api/v1/pagos-proveedores']['get']['parameters']['query']>, 'cursor' | 'empresas'>
export type CuerpoPagoProveedor = paths['/api/v1/pagos-proveedores']['post']['requestBody']['content']['application/json']

/**
 * Pagos a proveedores (A3, fase 5): se aplican a las compras pedidas y luego a la más antigua por
 * vencimiento; no pasan del saldo (422 `pago_excede_saldo`). En efectivo salen del turno abierto de la caja.
 */
export function usePagosProveedores() {
    const api = useApi()

    /** `GET /pagos-proveedores` (`compras.ver`). */
    function listar(filtros: FiltrosPagosProveedores = {}, cursor?: string): Promise<Resultado<Pagina<PagoProveedor>>> {
        return resolver(api.GET('/api/v1/pagos-proveedores', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `POST /pagos-proveedores` (`compras.pagar`). */
    function registrar(cuerpo: CuerpoPagoProveedor, idempotencia: string): Promise<Resultado<PagoProveedor>> {
        return resolver(api.POST('/api/v1/pagos-proveedores', { params: { header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `POST /pagos-proveedores/:id/anular` (`compras.pagar`): reverso; sus compras vuelven a quedar con saldo. */
    function anular(id: number, motivo: string, idempotencia: string): Promise<Resultado<PagoProveedor>> {
        return resolver(api.POST('/api/v1/pagos-proveedores/{id}/anular', { params: { path: { id }, header: { 'Idempotency-Key': idempotencia } }, body: { motivo } }))
    }

    return { listar, registrar, anular }
}
