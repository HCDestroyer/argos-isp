import { createApiClient } from '@argosisp/contracts'
import type { ApiClient } from '@argosisp/contracts'

export interface OpcionesClientePortal {
    baseUrl: string
    fetch?: typeof globalThis.fetch
}

/**
 * Cliente del portal: la sesión del cliente viaja en una cookie httpOnly que pone la API
 * (`credentials: 'include'`). Nunca se envía `Authorization: Bearer` desde el portal.
 */
export function crearClientePortal(opciones: OpcionesClientePortal): ApiClient {
    return createApiClient({
        baseUrl: opciones.baseUrl,
        fetch: opciones.fetch,
        credentials: 'include',
    })
}
