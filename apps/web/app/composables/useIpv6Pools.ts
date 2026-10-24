import type { Schema, paths } from '@argosisp/contracts'

export type Ipv6Pool = Schema<'Ipv6Pool'>
export type DatosIpv6Pool = paths['/api/v1/ipv6-bloques/{id}/pools']['post']['requestBody']['content']['application/json']

/** Pools IPv6 de un bloque del router: enlace (/64 por servicio) o delegación (/56, /48). */
export function useIpv6Pools() {
    const api = useApi()

    function listar(bloqueId: number): Promise<Resultado<Ipv6Pool[]>> {
        return resolver(api.GET('/api/v1/ipv6-bloques/{id}/pools', { params: { path: { id: bloqueId } } }))
    }

    /** `POST /ipv6-bloques/:id/pools` (`ipv6.crear`): el prefijo debe caer dentro del bloque; 422 si no o si se solapa. */
    function crear(bloqueId: number, datos: DatosIpv6Pool): Promise<Resultado<Ipv6Pool>> {
        return resolver(api.POST('/api/v1/ipv6-bloques/{id}/pools', { params: { path: { id: bloqueId } }, body: datos }))
    }

    return { listar, crear }
}
