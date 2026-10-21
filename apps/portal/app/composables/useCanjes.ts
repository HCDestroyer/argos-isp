import type { Schema } from '@argosisp/contracts'

export type CanjePortal = Schema<'PortalCanje'>

/** Canjes del cliente de la sesión (`GET /portal/canjes`), del más reciente. */
export function useCanjes() {
    const api = useApi()
    return useListaCursor<CanjePortal>(cursor => resolver(api.GET('/api/v1/portal/canjes', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}

/**
 * Canjear puntos por un premio (`POST /portal/canjes`): lo decide `lealtad.canjear` de A3 con el
 * cliente como actor. `clave` va en `Idempotency-Key`: la misma en los reintentos del mismo canje.
 */
export function useCanjear() {
    const api = useApi()
    function canjear(premioId: number, servicioId: number, clave: string): Promise<Resultado<CanjePortal>> {
        return resolver(api.POST('/api/v1/portal/canjes', {
            params: { header: { 'Idempotency-Key': clave } },
            body: { premio_id: premioId, servicio_id: servicioId },
            headers: { 'X-Canal': 'portal' },
        }))
    }
    return { canjear }
}
