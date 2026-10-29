import type { Schema, paths } from '@argosisp/contracts'

export type Ipv6Pool = Schema<'Ipv6Pool'>
export type DatosIpv6Pool = paths['/api/v1/ipv6-bloques/{id}/pools']['post']['requestBody']['content']['application/json']
export type CambiosIpv6Pool = paths['/api/v1/ipv6-pools/{id}']['put']['requestBody']['content']['application/json']
export type DatosVistaPreviaPool = paths['/api/v1/ipv6-pools/vista-previa']['post']['requestBody']['content']['application/json']
export type VistaPreviaPoolIpv6 = Schema<'VistaPreviaPoolIpv6'>

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

    function ver(id: number): Promise<Resultado<Ipv6Pool>> {
        return resolver(api.GET('/api/v1/ipv6-pools/{id}', { params: { path: { id } } }))
    }

    /**
     * `PUT /ipv6-pools/:id` (`ipv6.editar`) con `version`: el tipo y el tamaño solo cambian sin
     * prefijos asignados (422 `pool_con_asignaciones`); achicar responde 422 `prefijos_asignados_fuera`.
     */
    function editar(id: number, cambios: CambiosIpv6Pool): Promise<Resultado<Ipv6Pool>> {
        return resolver(api.PUT('/api/v1/ipv6-pools/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /ipv6-pools/vista-previa` (`ipv6.ver`): lo que entregaría el pool, sin guardarlo, y con qué se traslapa. */
    function vistaPrevia(datos: DatosVistaPreviaPool): Promise<Resultado<VistaPreviaPoolIpv6>> {
        return resolver(api.POST('/api/v1/ipv6-pools/vista-previa', { body: datos }))
    }

    return { listar, crear, ver, editar, vistaPrevia }
}
