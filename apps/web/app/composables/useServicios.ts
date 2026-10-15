import type { Schema, paths } from '@argosisp/contracts'

export type Servicio = Schema<'Servicio'>
export type FiltrosServicios = Omit<NonNullable<paths['/api/v1/servicios']['get']['parameters']['query']>, 'cursor'>

/** Servicios PPPoE: lista, ficha y alta. */
export function useServicios() {
    const api = useApi()

    function listar(filtros: FiltrosServicios = {}, cursor?: string): Promise<Resultado<Pagina<Servicio>>> {
        const query: FiltrosServicios & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/servicios', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Servicio>> {
        return resolver(api.GET('/api/v1/servicios/{id}', { params: { path: { id } } }))
    }

    return { listar, ver }
}
