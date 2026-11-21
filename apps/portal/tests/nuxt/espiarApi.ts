import { vi } from 'vitest'
import { useApi } from '~/composables/useApi'

/**
 * Espía `GET`/`POST` del cliente tipado del portal. El tipo de `useApi()` crece con cada ruta del
 * OpenAPI y `vi.spyOn` sobre él llega a TS2589 («instantiation is excessively deep»); aquí se
 * castea una sola vez a una firma laxa. Las pruebas leen las llamadas como `[ruta, opciones]`.
 */
type MetodoApi = 'GET' | 'POST'
type ClienteLaxo = Record<MetodoApi, (...args: unknown[]) => Promise<unknown>>

export function espiarApi(metodo: MetodoApi) {
    return vi.spyOn(useApi() as unknown as ClienteLaxo, metodo)
}
