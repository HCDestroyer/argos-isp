import type { Schema, paths } from '@argosisp/contracts'

/**
 * Red de acceso de un router (`contratos/red-acceso.md` §4, A1): VLAN, servidores PPPoE, el árbol
 * de la ficha, «Detectar en el router» y «Importar». Todo tipado desde `packages/contracts`. El
 * catálogo de OLT y puertos PON va en `useOlts`.
 */
export type RedAccesoRouter = Schema<'RedAccesoRouter'>
export type Vlan = Schema<'Vlan'>
export type ServidorPppoe = Schema<'ServidorPppoe'>
export type DescubrimientoRedAcceso = Schema<'DescubrimientoRedAcceso'>
export type ResultadoAdopcion = Schema<'ResultadoAdopcion'>
export type DatosVlan = paths['/api/v1/routers/{id}/vlans']['post']['requestBody']['content']['application/json']
export type CambiosVlan = paths['/api/v1/vlans/{id}']['put']['requestBody']['content']['application/json']
export type DatosServidorPppoe = paths['/api/v1/routers/{id}/servidores-pppoe']['post']['requestBody']['content']['application/json']
export type CambiosServidorPppoe = paths['/api/v1/servidores-pppoe/{id}']['put']['requestBody']['content']['application/json']
export type DatosAdopcion = paths['/api/v1/routers/{id}/red-acceso/adoptar']['post']['requestBody']['content']['application/json']
export type AutenticacionPppoe = ServidorPppoe['autenticacion'][number]

export const AUTENTICACIONES_PPPOE = ['pap', 'chap', 'mschap1', 'mschap2'] as const satisfies readonly AutenticacionPppoe[]

export function useRedAcceso() {
    const api = useApi()

    /** `GET /routers/:id/red-acceso` (`red_acceso.ver`): VLAN, servidores con `local_address` y OLT usadas. */
    function ver(routerId: number): Promise<Resultado<RedAccesoRouter>> {
        return resolver(api.GET('/api/v1/routers/{id}/red-acceso', { params: { path: { id: routerId } } }))
    }

    /** `POST /routers/:id/vlans` (`vlans.crear`): VLAN administrada (422 `puerto_pon_lleno`, 409 `vlan_duplicada`). */
    function crearVlan(routerId: number, datos: DatosVlan): Promise<Resultado<Vlan>> {
        return resolver(api.POST('/api/v1/routers/{id}/vlans', { params: { path: { id: routerId } }, body: datos }))
    }

    /** `PUT /vlans/:id` (`vlans.editar`) con `version`; en una adoptada solo lo propio de Argos (422 `adoptado_solo_lectura`). */
    function editarVlan(id: number, cambios: CambiosVlan): Promise<Resultado<Vlan>> {
        return resolver(api.PUT('/api/v1/vlans/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `DELETE /vlans/:id` (`vlans.eliminar`): 409 `vlan_con_servidor`. */
    function eliminarVlan(id: number): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/vlans/{id}', { params: { path: { id } } }))
    }

    /** `POST /routers/:id/servidores-pppoe` (`servidores_pppoe.crear`): con red con gateway (422 `red_requerida`, `red_sin_gateway`). */
    function crearServidor(routerId: number, datos: DatosServidorPppoe): Promise<Resultado<ServidorPppoe>> {
        return resolver(api.POST('/api/v1/routers/{id}/servidores-pppoe', { params: { path: { id: routerId } }, body: datos }))
    }

    /** `PUT /servidores-pppoe/:id` (`servidores_pppoe.editar`) con `version`. */
    function editarServidor(id: number, cambios: CambiosServidorPppoe): Promise<Resultado<ServidorPppoe>> {
        return resolver(api.PUT('/api/v1/servidores-pppoe/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `DELETE /servidores-pppoe/:id` (`servidores_pppoe.eliminar`): 409 `servidor_con_servicios`. */
    function eliminarServidor(id: number): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/servidores-pppoe/{id}', { params: { path: { id } } }))
    }

    /** `GET /routers/:id/servidores-pppoe` (`red_acceso.ver`): para el selector del servicio. */
    function servidores(routerId: number): Promise<Resultado<ServidorPppoe[]>> {
        return resolver(api.GET('/api/v1/routers/{id}/servidores-pppoe', { params: { path: { id: routerId } } }))
    }

    /** `GET /servidores-pppoe/:id` (`red_acceso.ver`): para el nombre en la ficha del servicio. */
    function verServidor(id: number): Promise<Resultado<ServidorPppoe>> {
        return resolver(api.GET('/api/v1/servidores-pppoe/{id}', { params: { path: { id } } }))
    }

    /** `GET /routers/:id/red-acceso/descubrir` (`red_acceso.descubrir`): lee el router (501 `descubrir_no_disponible`, 502). */
    function descubrir(routerId: number): Promise<Resultado<DescubrimientoRedAcceso>> {
        return resolver(api.GET('/api/v1/routers/{id}/red-acceso/descubrir', { params: { path: { id: routerId } } }))
    }

    /** `POST /routers/:id/red-acceso/adoptar` (`red_acceso.adoptar`, `Idempotency-Key`): 409 `inventario_cambio`, `ya_registrado`. */
    function adoptar(routerId: number, datos: DatosAdopcion, claveIdempotencia: string): Promise<Resultado<ResultadoAdopcion>> {
        return resolver(api.POST('/api/v1/routers/{id}/red-acceso/adoptar', {
            params: { path: { id: routerId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { ver, crearVlan, editarVlan, eliminarVlan, crearServidor, editarServidor, eliminarServidor, servidores, verServidor, descubrir, adoptar }
}
