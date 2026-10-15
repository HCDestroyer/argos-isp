import type { Schema, paths } from '@argosisp/contracts'

export type Plan = Schema<'Plan'>
export type FiltrosPlanes = Omit<NonNullable<paths['/api/v1/planes']['get']['parameters']['query']>, 'cursor'>

/** Planes de velocidad. */
export function usePlanes() {
    const api = useApi()

    function listar(filtros: FiltrosPlanes = {}, cursor?: string): Promise<Resultado<Pagina<Plan>>> {
        const query: FiltrosPlanes & { cursor?: string } = { limit: 200, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/planes', { params: { query } }))
    }

    return { listar }
}
