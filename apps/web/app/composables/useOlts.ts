import type { Schema, paths } from '@argosisp/contracts'

/**
 * Catálogo de OLT y sus puertos PON (`contratos/red-acceso.md` §4, A1). Son datos para ordenar y
 * filtrar: Argos nunca habla con la OLT. Máximo 2 VLAN por puerto (`PuertoPon.vlans`).
 */
export type Olt = Schema<'Olt'>
export type PuertoPon = Schema<'PuertoPon'>
export type DatosOlt = paths['/api/v1/olts']['post']['requestBody']['content']['application/json']
export type CambiosOlt = paths['/api/v1/olts/{id}']['put']['requestBody']['content']['application/json']
export type DatosPuertoPon = paths['/api/v1/olts/{id}/puertos-pon']['post']['requestBody']['content']['application/json']
export type CambiosPuertoPon = paths['/api/v1/puertos-pon/{id}']['put']['requestBody']['content']['application/json']

/** Máximo de VLAN por puerto PON (`puerto_pon_lleno`). */
export const MAXIMO_VLANS_POR_PUERTO = 2

export function useOlts() {
    const api = useApi()

    /** `GET /olts` (`red_acceso.ver`), por cursor. */
    function listar(cursor?: string): Promise<Resultado<Pagina<Olt>>> {
        return resolver(api.GET('/api/v1/olts', { params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } } }))
    }

    function crear(datos: DatosOlt): Promise<Resultado<Olt>> {
        return resolver(api.POST('/api/v1/olts', { body: datos }))
    }

    function editar(id: number, cambios: CambiosOlt): Promise<Resultado<Olt>> {
        return resolver(api.PUT('/api/v1/olts/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `DELETE /olts/:id` (`olts.eliminar`): 409 `olt_con_vlans`. */
    function eliminar(id: number): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/olts/{id}', { params: { path: { id } } }))
    }

    function agregarPuerto(oltId: number, datos: DatosPuertoPon): Promise<Resultado<PuertoPon>> {
        return resolver(api.POST('/api/v1/olts/{id}/puertos-pon', { params: { path: { id: oltId } }, body: datos }))
    }

    function editarPuerto(id: number, cambios: CambiosPuertoPon): Promise<Resultado<PuertoPon>> {
        return resolver(api.PUT('/api/v1/puertos-pon/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `DELETE /puertos-pon/:id` (`olts.editar`): 409 `puerto_con_vlans`. */
    function eliminarPuerto(id: number): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/puertos-pon/{id}', { params: { path: { id } } }))
    }

    return { listar, crear, editar, eliminar, agregarPuerto, editarPuerto, eliminarPuerto }
}
