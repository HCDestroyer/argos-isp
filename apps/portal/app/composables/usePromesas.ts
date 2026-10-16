import type { Schema } from '@argosisp/contracts'

export type PromesaPortal = Schema<'PortalPromesa'>

/** Promesas de pago del cliente de la sesión. Solo lectura: se solicitan desde `/corte` (día 4, 2.ª tanda). */
export function usePromesas() {
    const api = useApi()
    return useListaCursor<PromesaPortal>(cursor => resolver(api.GET('/api/v1/portal/promesas', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}
