import type { Schema, paths } from '@argosisp/contracts'

export type Compra = Schema<'Compra'>
export type LineaCompra = Schema<'LineaCompra'>
export type FiltrosCompras = Omit<NonNullable<paths['/api/v1/compras']['get']['parameters']['query']>, 'cursor'>

/**
 * Compras (A3, fase 5, `compras.ver`). Por ahora el panel solo las lee para entregar el bien de un
 * premio de sorteo con la contrapartida `compra` (la línea del bien comprado con factura).
 */
export function useCompras() {
    const api = useApi()

    function listar(filtros: FiltrosCompras = {}, cursor?: string): Promise<Resultado<Pagina<Compra>>> {
        const query: FiltrosCompras & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/compras', { params: { query } }))
    }

    return { listar }
}
