import type { Schema } from '@argosisp/contracts'

export type NotaCreditoPortal = Schema<'PortalNotaCredito'>

/** Notas de crédito (internas y NCRE) del cliente de la sesión, más recientes primero, y su XML. */
export function useNotasCredito() {
    const api = useApi()
    const lista = useListaCursor<NotaCreditoPortal>(cursor => resolver(api.GET('/api/v1/portal/notas-credito', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))

    /** XML de la NCRE certificada en el mismo origen del portal (Nitro lo reenvía con la cookie). */
    function urlXml(id: number): string {
        return `/api/v1/portal/notas-credito/${id}/xml`
    }

    return { ...lista, urlXml }
}
