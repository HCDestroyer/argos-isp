import type { Schema, paths } from '@argosisp/contracts'

export type ConfigEquipos = Schema<'ConfigEquipos'>
export type PruebaEquipos = Schema<'PruebaEquipos'>
export type CambiosConfigEquipos = Omit<paths['/api/v1/integraciones/equipos']['put']['requestBody']['content']['application/json'], 'version'>

/**
 * SmartOLT y GenieACS de la empresa activa (A6, CLAUDE.md §14: un ACS y una OLT por empresa). Los
 * secretos se guardan cifrados y nunca vuelven: llegan como `***` o `null`.
 */
export function useEquiposIntegracion() {
    const api = useApi()

    /** `GET /integraciones/equipos` (`equipos.ver`); `version` 0 = nunca se guardó. */
    function ver(): Promise<Resultado<ConfigEquipos>> {
        return resolver(api.GET('/api/v1/integraciones/equipos'))
    }

    /**
     * `PUT /integraciones/equipos` (`equipos.configurar`): un secreto omitido se conserva, `null` lo
     * borra y un texto lo reemplaza. Cambiar URL o secreto borra la última prueba.
     */
    function guardar(version: number, cambios: CambiosConfigEquipos): Promise<Resultado<ConfigEquipos>> {
        return resolver(api.PUT('/api/v1/integraciones/equipos', { body: { version, ...cambios } }))
    }

    /** `POST /integraciones/equipos/probar` (`equipos.probar`): prueba lo guardado; nunca falla por un sistema caído. */
    function probar(): Promise<Resultado<PruebaEquipos>> {
        return resolver(api.POST('/api/v1/integraciones/equipos/probar'))
    }

    return { ver, guardar, probar }
}
