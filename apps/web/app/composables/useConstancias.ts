import type { paths } from '@argosisp/contracts'

export type FiltrosConstancias = Omit<NonNullable<paths['/api/v1/constancias']['get']['parameters']['query']>, 'cursor' | 'empresas'>

/** Constancias de retención (A3, fase 5): las recibidas de clientes con su pago y las emitidas a proveedores con su compra. */
export function useConstancias() {
    const api = useApi()

    /** `GET /constancias` (`compras.ver`). */
    function listar(filtros: FiltrosConstancias = {}, cursor?: string): Promise<Resultado<Pagina<ConstanciaRetencion>>> {
        return resolver(api.GET('/api/v1/constancias', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    return { listar }
}
