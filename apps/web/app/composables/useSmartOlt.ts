import type { Schema, paths } from '@argosisp/contracts'

export type InstanciaSmartOlt = Schema<'InstanciaSmartOlt'>
export type OltSmartOlt = Schema<'OltSmartOlt'>
export type PruebaInstanciaSmartOlt = Schema<'PruebaInstanciaSmartOlt'>
export type DatosInstanciaSmartOlt = paths['/api/v1/integraciones/smartolt/instancias']['post']['requestBody']['content']['application/json']
export type CambiosInstanciaSmartOlt = Omit<paths['/api/v1/integraciones/smartolt/instancias/{id}']['put']['requestBody']['content']['application/json'], 'version'>

/**
 * Instancias (cuentas, subdominios) de SmartOLT de la empresa activa y las compartidas, con sus OLT
 * (`contratos/equipos-olt-acs.md` §5.1). El token nunca vuelve (`***`). «Probar» es una sola llamada
 * a SmartOLT que comprueba el token y trae las OLT.
 */
export function useSmartOlt() {
    const api = useApi()

    /** `GET /integraciones/smartolt/instancias` (`smartolt.ver`): todas las páginas. */
    async function listar(): Promise<Resultado<InstanciaSmartOlt[]>> {
        const todas: InstanciaSmartOlt[] = []
        let cursor: string | undefined
        do {
            const r = await resolver(api.GET('/api/v1/integraciones/smartolt/instancias', { params: { query: { cursor, limit: 200 } } }))
            if (!r.ok) {
                return r
            }
            todas.push(...r.data.data)
            cursor = r.data.nextCursor ?? undefined
        } while (cursor)
        return { ok: true, data: todas }
    }

    function ver(id: number): Promise<Resultado<InstanciaSmartOlt>> {
        return resolver(api.GET('/api/v1/integraciones/smartolt/instancias/{id}', { params: { path: { id } } }))
    }

    /** `POST` (`smartolt.crear_instancia`): compartida solo con alcance global. */
    function crear(datos: DatosInstanciaSmartOlt): Promise<Resultado<InstanciaSmartOlt>> {
        return resolver(api.POST('/api/v1/integraciones/smartolt/instancias', { body: datos }))
    }

    /** `PUT` (`smartolt.editar_instancia`): el token omitido se conserva; cambiar URL o token borra la prueba. */
    function editar(id: number, version: number, cambios: CambiosInstanciaSmartOlt): Promise<Resultado<InstanciaSmartOlt>> {
        return resolver(api.PUT('/api/v1/integraciones/smartolt/instancias/{id}', { params: { path: { id } }, body: { version, ...cambios } }))
    }

    /** `DELETE` (`smartolt.eliminar_instancia`): `409 instancia_en_uso` si un equipo o un pedido la usa. */
    function eliminar(id: number): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/integraciones/smartolt/instancias/{id}', { params: { path: { id } } }))
    }

    /** `POST …/probar` (`smartolt.probar_instancia`): prueba lo guardado y sincroniza las OLT. */
    function probar(id: number): Promise<Resultado<PruebaInstanciaSmartOlt>> {
        return resolver(api.POST('/api/v1/integraciones/smartolt/instancias/{id}/probar', { params: { path: { id } } }))
    }

    /** `POST /integraciones/smartolt/olts/:id/vincular` (`smartolt.vincular_olt`); `null` la desliga. */
    function vincular(oltId: number, oltArgosId: number | null): Promise<Resultado<OltSmartOlt>> {
        return resolver(api.POST('/api/v1/integraciones/smartolt/olts/{id}/vincular', { params: { path: { id: oltId } }, body: { olt_id: oltArgosId } }))
    }

    return { listar, ver, crear, editar, eliminar, probar, vincular }
}
