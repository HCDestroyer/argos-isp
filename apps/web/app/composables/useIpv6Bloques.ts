import type { Schema, paths } from '@argosisp/contracts'

export type CambiosIpv6Bloque = paths['/api/v1/ipv6-bloques/{id}']['put']['requestBody']['content']['application/json']
export type DatosMigrarBloque = paths['/api/v1/ipv6-bloques/{id}/migrar']['post']['requestBody']['content']['application/json']
export type DatosVistaPreviaBloque = paths['/api/v1/ipv6-bloques/vista-previa']['post']['requestBody']['content']['application/json']
export type VistaPreviaBloqueIpv6 = Schema<'VistaPreviaBloqueIpv6'>

/** Un bloque IPv6 del router (`contratos/pools.md`): detalle, edición, migración y vista previa. */
export function useIpv6Bloques() {
    const api = useApi()

    function ver(id: number): Promise<Resultado<Ipv6Bloque>> {
        return resolver(api.GET('/api/v1/ipv6-bloques/{id}', { params: { path: { id } } }))
    }

    /** `PUT /ipv6-bloques/:id` (`ipv6.editar`): 422 `pools_fuera_del_bloque` con la lista si al achicar queda un pool fuera. */
    function editar(id: number, cambios: CambiosIpv6Bloque): Promise<Resultado<Ipv6Bloque>> {
        return resolver(api.PUT('/api/v1/ipv6-bloques/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /ipv6-bloques/:id/migrar` (`ipv6.migrar`): el bloque se muda con sus pools. */
    function migrar(id: number, datos: DatosMigrarBloque): Promise<Resultado<MigracionPools>> {
        return resolver(api.POST('/api/v1/ipv6-bloques/{id}/migrar', { params: { path: { id } }, body: datos }))
    }

    /** `POST /ipv6-bloques/vista-previa` (`ipv6.ver`): división sugerida en pools y lo que recibe cada cliente. */
    function vistaPrevia(datos: DatosVistaPreviaBloque): Promise<Resultado<VistaPreviaBloqueIpv6>> {
        return resolver(api.POST('/api/v1/ipv6-bloques/vista-previa', { body: datos }))
    }

    return { ver, editar, migrar, vistaPrevia }
}
