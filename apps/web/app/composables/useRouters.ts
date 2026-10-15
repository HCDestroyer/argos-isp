import type { Schema, paths } from '@argosisp/contracts'

/** `Router` a secas choca con el tipo de vue-router. */
export type RouterNas = Schema<'Router'>
export type RedIpv4 = Schema<'RedIpv4'>
export type Ipv6Bloque = Schema<'Ipv6Bloque'>
export type FiltrosRouters = Omit<NonNullable<paths['/api/v1/routers']['get']['parameters']['query']>, 'cursor'>

/** Routers MikroTik y lo que cuelga de ellos: planes implementados, redes IPv4 y bloques IPv6. */
export function useRouters() {
    const api = useApi()

    function listar(filtros: FiltrosRouters = {}, cursor?: string): Promise<Resultado<Pagina<RouterNas>>> {
        const query: FiltrosRouters & { cursor?: string } = { limit: 200, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/routers', { params: { query } }))
    }

    /** Planes disponibles en el router (globales + implementados en él). */
    function planes(id: number): Promise<Resultado<Plan[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/planes', { params: { path: { id } } }))
    }

    function redesIpv4(id: number): Promise<Resultado<RedIpv4[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/redes-ipv4', { params: { path: { id } } }))
    }

    function ipv6Bloques(id: number): Promise<Resultado<Ipv6Bloque[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/ipv6-bloques', { params: { path: { id } } }))
    }

    return { listar, planes, redesIpv4, ipv6Bloques }
}
