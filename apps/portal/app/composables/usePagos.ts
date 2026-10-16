import type { Schema } from '@argosisp/contracts'

export type PagoPortal = Schema<'PortalPago'>

/** Pagos del cliente de la sesión (incluye depósitos pendientes de verificación). */
export function usePagos() {
    const api = useApi()
    return useListaCursor<PagoPortal>(cursor => resolver(api.GET('/api/v1/portal/pagos', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}
