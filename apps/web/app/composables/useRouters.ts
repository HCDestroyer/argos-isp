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
export type MigracionAaa = Schema<'MigracionAaaRouter'>
export type DatosMarcarMigrado = paths['/api/v1/routers/{id}/marcar-migrado']['post']['requestBody']['content']['application/json']
export type ResumenSesionesRouter = Schema<'ResumenSesionesRouter'>
export type DatosRouter = paths['/api/v1/routers']['post']['requestBody']['content']['application/json']
export type DatosRedIpv4 = paths['/api/v1/routers/{id}/redes-ipv4']['post']['requestBody']['content']['application/json']
export type DatosIpv6Bloque = paths['/api/v1/routers/{id}/ipv6-bloques']['post']['requestBody']['content']['application/json']
export type ServicioSinSesion = Schema<'ServicioSinSesion'>
/** `GET …/eliminable` (`contratos/eliminar.md` §1): si se puede eliminar y por qué no. */
export type Eliminable = Schema<'Eliminable'>

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

    /** `POST /routers` (`routers.crear`): nombre, host, NAS, secretos (se guardan cifrados) y colas. */
    function crear(datos: DatosRouter): Promise<Resultado<RouterNas>> {
        return resolver(api.POST('/api/v1/routers', { body: datos }))
    }

    /** `POST /routers/:id/redes-ipv4` (`redes.crear`): red en CIDR, estática o pool; 422 si se solapa. */
    function agregarRed(id: number, datos: DatosRedIpv4): Promise<Resultado<RedIpv4>> {
        return resolver(api.POST('/api/v1/routers/{id}/redes-ipv4', { params: { path: { id } }, body: datos }))
    }

    /** `POST /routers/:id/ipv6-bloques` (`ipv6.crear`): bloque IPv6 del router, que luego se reparte en pools. */
    function agregarBloque(id: number, datos: DatosIpv6Bloque): Promise<Resultado<Ipv6Bloque>> {
        return resolver(api.POST('/api/v1/routers/{id}/ipv6-bloques', { params: { path: { id } }, body: datos }))
    }

    function redesIpv4(id: number): Promise<Resultado<RedIpv4[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/redes-ipv4', { params: { path: { id } } }))
    }

    function ipv6Bloques(id: number): Promise<Resultado<Ipv6Bloque[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/ipv6-bloques', { params: { path: { id } } }))
    }

    /** `GET /routers/:id/migracion-aaa` (`routers.ver`): fecha de paso al nuevo `aaa` y el primer accounting. */
    function migracionAaa(id: number): Promise<Resultado<MigracionAaa>> {
        return resolver(api.GET('/api/v1/routers/{id}/migracion-aaa', { params: { path: { id } } }))
    }

    /**
     * `POST /routers/:id/marcar-migrado` (`routers.marcar_migrado`): `desde` omitido = ahora,
     * `null` = desmarcar; motivo obligatorio; con `version` responde 409 si cambió. No toca el router.
     */
    function marcarMigrado(id: number, datos: DatosMarcarMigrado, claveIdempotencia: string): Promise<Resultado<MigracionAaa>> {
        return resolver(api.POST('/api/v1/routers/{id}/marcar-migrado', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /**
     * `GET /routers/:id/resumen-sesiones?desde=` (`sesiones.ver`): servicios PPPoE, con sesión
     * activa y los que no tuvieron sesión desde `desde` (sin él, la fecha de migración; 422 si no hay).
     */
    function resumenSesiones(id: number, desde?: string): Promise<Resultado<ResumenSesionesRouter>> {
        return resolver(api.GET('/api/v1/routers/{id}/resumen-sesiones', { params: { path: { id }, query: desde ? { desde } : {} } }))
    }

    /** `GET /routers/:id/eliminable` (`routers.ver`): si nunca se usó y, si no, los motivos. */
    function eliminable(id: number): Promise<Resultado<Eliminable>> {
        return resolver(api.GET('/api/v1/routers/{id}/eliminable', { params: { path: { id } } }))
    }

    /**
     * `DELETE /routers/:id?version=N` (`routers.eliminar`, solo admin): 204. 409 si otra sesión lo
     * cambió; 422 `router_con_historial` con los motivos en `errors[]`.
     */
    function eliminar(id: number, version: number, claveIdempotencia: string): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/routers/{id}', {
            params: { path: { id }, query: { version }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    return { eliminable, eliminar, listar, ver, editar, cambiarControlVelocidad, vistaPreviaControl, planes, redesIpv4, ipv6Bloques, migracionAaa, marcarMigrado, resumenSesiones, crear, agregarRed, agregarBloque }
}
