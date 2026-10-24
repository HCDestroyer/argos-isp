import type { Schema, paths } from '@argosisp/contracts'

export type UnidadInventario = Schema<'UnidadInventario'>
export type UnidadInventarioHistorial = Schema<'UnidadInventarioHistorial'>
export type EstadoUnidadInventario = UnidadInventario['estado']
export type FiltrosUnidades = Omit<NonNullable<paths['/api/v1/inventario/unidades']['get']['parameters']['query']>, 'cursor'>

/** Equipos por serie o MAC (A3): búsqueda, historial y `marcar_reparada`. */
export function useUnidadesInventario() {
    const api = useApi()

    /** `GET /inventario/unidades`: `q` busca la serie («contiene») y la MAC con o sin separadores. */
    function listar(filtros: FiltrosUnidades = {}, cursor?: string): Promise<Resultado<Pagina<UnidadInventario>>> {
        const query: FiltrosUnidades & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/inventario/unidades', { params: { query } }))
    }

    /** `GET /inventario/unidades/:id`: la unidad con su historial de movimientos. */
    function ver(id: number): Promise<Resultado<UnidadInventarioHistorial>> {
        return resolver(api.GET('/api/v1/inventario/unidades/{id}', { params: { path: { id } } }))
    }

    /** `POST /inventario/unidades/:id/marcar-reparada` (`inventario.marcar_reparada`): de `en_reparacion` a `disponible`. */
    function marcarReparada(id: number, motivo: string): Promise<Resultado<UnidadInventario>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/marcar-reparada', { params: { path: { id } }, body: { motivo } }))
    }

    return { listar, ver, marcarReparada }
}
