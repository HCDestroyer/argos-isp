import type { Schema } from '@argosisp/contracts'

export type FacturaPortal = Schema<'PortalFactura'>

/** Tamaño de página de las listas del portal (móvil: pocas tarjetas por carga). */
export const LIMITE_LISTA_PORTAL = 10

/** Facturas (avisos de cobro) del cliente de la sesión, más recientes primero, y la URL de su PDF. */
export function useFacturas() {
    const api = useApi()
    const lista = useListaCursor<FacturaPortal>(cursor => resolver(api.GET('/api/v1/portal/facturas', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))

    /** PDF del aviso de cobro en el mismo origen del portal (Nitro lo reenvía a la API con la cookie). */
    function urlPdf(id: number): string {
        return `/api/v1/portal/facturas/${id}/pdf`
    }

    return { ...lista, urlPdf }
}
