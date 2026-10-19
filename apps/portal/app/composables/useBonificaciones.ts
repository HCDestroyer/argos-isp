import type { Schema } from '@argosisp/contracts'

export type BonificacionPortal = Schema<'PortalBonificacion'>

/**
 * Periodos bonificados del cliente de la sesión (`GET /portal/bonificaciones`): decisión del PM, un
 * mes gratis, un canje o un cargo sin costo ya no es una factura de Q0 sino una bonificación. Sin
 * montos ni documento: nada que pagar ni descargar.
 */
export function useBonificaciones() {
    const api = useApi()
    return useListaCursor<BonificacionPortal>(cursor => resolver(api.GET('/api/v1/portal/bonificaciones', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}
