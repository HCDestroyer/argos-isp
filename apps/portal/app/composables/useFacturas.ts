import type { Schema } from '@argosisp/contracts'

export type FacturaPortal = Schema<'PortalFactura'>

/** Tamaño de página de las listas del portal (móvil: pocas tarjetas por carga). */
export const LIMITE_LISTA_PORTAL = 10

/** Facturas (avisos de cobro) del cliente de la sesión, más recientes primero. */
export function useFacturas() {
    const api = useApi()
    return useListaCursor<FacturaPortal>(cursor => resolver(api.GET('/api/v1/portal/facturas', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}
