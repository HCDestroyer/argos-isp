import type { Schema, paths } from '@argosisp/contracts'

export type PromesaPortal = Schema<'PortalPromesa'>
export type CondicionesPromesa = Schema<'PortalCondicionesPromesa'>
export type PromesaSolicitada = Schema<'PortalPromesaSolicitada'>
export type SolicitudPromesa = paths['/api/v1/portal/promesas']['post']['requestBody']['content']['application/json']

/** Promesas de pago del cliente de la sesión (lista de `/cuenta`). */
export function usePromesas() {
    const api = useApi()
    return useListaCursor<PromesaPortal>(cursor => resolver(api.GET('/api/v1/portal/promesas', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}

/**
 * Solicitar una promesa de pago (tarea 4). La decisión es del backend (`CrearPromesaPago` de A3,
 * canal `portal`): aquí solo se leen los límites para mostrarlos y se envía la solicitud.
 *
 * Sin `servicioId` el servicio se identifica por la IP de origen (`/corte`); con `servicioId`, por
 * la sesión del portal (`/cuenta`).
 */
export function useSolicitudPromesa() {
    const api = useApi()

    function condiciones(servicioId?: number): Promise<Resultado<CondicionesPromesa>> {
        return resolver(api.GET('/api/v1/portal/promesas/condiciones', {
            params: { query: servicioId ? { servicio_id: servicioId } : {} },
            headers: { 'X-Canal': 'portal' },
        }))
    }

    /** `clave` va en `Idempotency-Key`: la misma en los reintentos del mismo envío. */
    function solicitar(datos: SolicitudPromesa, clave: string): Promise<Resultado<PromesaSolicitada>> {
        return resolver(api.POST('/api/v1/portal/promesas', {
            params: { header: { 'Idempotency-Key': clave } },
            body: datos,
            headers: { 'X-Canal': 'portal' },
        }))
    }

    return { condiciones, solicitar }
}
