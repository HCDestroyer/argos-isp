import type { Schema, paths } from '@argosisp/contracts'

/** `Router` a secas choca con el tipo de vue-router. */
export type RouterNas = Schema<'Router'>
export type FiltrosRouters = Omit<NonNullable<paths['/api/v1/routers']['get']['parameters']['query']>, 'cursor'>

/** Routers MikroTik. */
export function useRouters() {
    const api = useApi()

    function listar(filtros: FiltrosRouters = {}, cursor?: string): Promise<Resultado<Pagina<RouterNas>>> {
        const query: FiltrosRouters & { cursor?: string } = { limit: 200, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/routers', { params: { query } }))
    }

    return { listar }
}
