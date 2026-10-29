import type { Schema, paths } from '@argosisp/contracts'

export type CambiosRedIpv4 = paths['/api/v1/redes-ipv4/{id}']['put']['requestBody']['content']['application/json']
export type DatosMigrarRed = paths['/api/v1/redes-ipv4/{id}/migrar']['post']['requestBody']['content']['application/json']
export type MigracionPools = Schema<'MigracionPools'>

/** Una red IPv4 del router (`contratos/pools.md`): detalle, edición con `version` y migración. */
export function useRedesIpv4() {
    const api = useApi()

    function ver(id: number): Promise<Resultado<RedIpv4>> {
        return resolver(api.GET('/api/v1/redes-ipv4/{id}', { params: { path: { id } } }))
    }

    /** `PUT /redes-ipv4/:id` (`redes.editar`): 422 `ips_asignadas_fuera` con la lista si al achicar queda una IP fuera. */
    function editar(id: number, cambios: CambiosRedIpv4): Promise<Resultado<RedIpv4>> {
        return resolver(api.PUT('/api/v1/redes-ipv4/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /redes-ipv4/:id/migrar` (`redes.migrar`): con `simular` no guarda; 422 `pool_con_servicios` sin `mover_servicios`. */
    function migrar(id: number, datos: DatosMigrarRed): Promise<Resultado<MigracionPools>> {
        return resolver(api.POST('/api/v1/redes-ipv4/{id}/migrar', { params: { path: { id } }, body: datos }))
    }

    return { ver, editar, migrar }
}
