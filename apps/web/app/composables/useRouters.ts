import type { Schema, paths } from '@argosisp/contracts'

/** `Router` a secas choca con el tipo de vue-router. */
export type RouterNas = Schema<'Router'>
export type RedIpv4 = Schema<'RedIpv4'>
export type Ipv6Bloque = Schema<'Ipv6Bloque'>
export type FiltrosRouters = Omit<NonNullable<paths['/api/v1/routers']['get']['parameters']['query']>, 'cursor'>
export type PlanEfectivo = Schema<'PlanEfectivo'>
export type CambiosRouter = paths['/api/v1/routers/{id}']['put']['requestBody']['content']['application/json']
export type VistaPreviaControl = Schema<'VistaPreviaControl'>
export type CambioControlVelocidad = paths['/api/v1/routers/{id}/cambiar-control-velocidad']['post']['requestBody']['content']['application/json']

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

    function ver(id: number): Promise<Resultado<RouterNas>> {
        return resolver(api.GET('/api/v1/routers/{id}', { params: { path: { id } } }))
    }

    /** `PUT /routers/:id` (`routers.editar`) con `version`: datos y capacidad del enlace (no el modo de colas). */
    function editar(id: number, cambios: CambiosRouter): Promise<Resultado<RouterNas>> {
        return resolver(api.PUT('/api/v1/routers/{id}', { params: { path: { id } }, body: cambios }))
    }

    /**
     * `POST /routers/:id/cambiar-control-velocidad` (`routers.cambiar_control_velocidad`, solo
     * admin) con `version`; 409 si el router cambió. Emite `router.control_cambiado`.
     */
    function cambiarControlVelocidad(id: number, datos: CambioControlVelocidad): Promise<Resultado<RouterNas>> {
        return resolver(api.POST('/api/v1/routers/{id}/cambiar-control-velocidad', { params: { path: { id } }, body: datos }))
    }

    /**
     * `GET /routers/:id/vista-previa-control?a=` (`routers.cambiar_control_velocidad`): lo que el
     * cambio a `a` crea, corrige y borra en RouterOS, los lotes y las sesiones PPPoE que se
     * desconectan. No toca el router. Con `a` igual al modo actual todo viene vacío.
     */
    function vistaPreviaControl(id: number, a: ControlVelocidad): Promise<Resultado<VistaPreviaControl>> {
        return resolver(api.GET('/api/v1/routers/{id}/vista-previa-control', { params: { path: { id }, query: { a } } }))
    }

    /** Planes disponibles en el router (globales + implementados en él), con su rate-limit efectivo. */
    function planes(id: number): Promise<Resultado<PlanEfectivo[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/planes', { params: { path: { id } } }))
    }

    function redesIpv4(id: number): Promise<Resultado<RedIpv4[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/redes-ipv4', { params: { path: { id } } }))
    }

    function ipv6Bloques(id: number): Promise<Resultado<Ipv6Bloque[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/ipv6-bloques', { params: { path: { id } } }))
    }

    return { listar, ver, editar, cambiarControlVelocidad, vistaPreviaControl, planes, redesIpv4, ipv6Bloques }
}
