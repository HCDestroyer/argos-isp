import { createApiClient } from '@argosisp/contracts'
import type { ApiClient } from '@argosisp/contracts'
import { CABECERA_CODIGO_CORTE } from './codigoCorte'

export interface OpcionesClientePortal {
    baseUrl: string
    fetch?: typeof globalThis.fetch
    /** Código de corte de la pestaña (`?c=` de `/corte`): va en `X-Argos-Corte` si lo hay. */
    codigoCorte?: () => string | null
}

/**
 * Cliente del portal: la sesión del cliente viaja en una cookie httpOnly que pone la API
 * (`credentials: 'include'`). Nunca se envía `Authorization: Bearer` desde el portal.
 */
export function crearClientePortal(opciones: OpcionesClientePortal): ApiClient {
    const cliente = createApiClient({
        baseUrl: opciones.baseUrl,
        fetch: opciones.fetch,
        credentials: 'include',
    })
    cliente.use({
        onRequest({ request }) {
            const codigo = opciones.codigoCorte?.()
            if (codigo) {
                request.headers.set(CABECERA_CODIGO_CORTE, codigo)
            }
            return request
        },
    })
    return cliente
}
