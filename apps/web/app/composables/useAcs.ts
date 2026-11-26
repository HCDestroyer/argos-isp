import type { Schema, paths } from '@argosisp/contracts'

export type ConfigAcs = Schema<'ConfigAcs'>
export type PruebaAcs = Schema<'PruebaAcs'>
export type CambiosAcs = Omit<paths['/api/v1/integraciones/acs']['put']['requestBody']['content']['application/json'], 'version'>

/**
 * El ACS (GenieACS) de la empresa activa: uno por empresa, independiente de SmartOLT
 * (`contratos/equipos-olt-acs.md` §3.4). La clave nunca vuelve (`***`).
 */
export function useAcs() {
    const api = useApi()

    /** `GET /integraciones/acs` (`acs.ver`); `version` 0 = nunca se guardó. */
    function ver(): Promise<Resultado<ConfigAcs>> {
        return resolver(api.GET('/api/v1/integraciones/acs'))
    }

    /** `PUT /integraciones/acs` (`acs.configurar`): clave omitida se conserva, `null` la borra. */
    function guardar(version: number, cambios: CambiosAcs): Promise<Resultado<ConfigAcs>> {
        return resolver(api.PUT('/api/v1/integraciones/acs', { body: { version, ...cambios } }))
    }

    /** `POST /integraciones/acs/probar` (`acs.probar`): prueba lo guardado; no llama a SmartOLT. */
    function probar(): Promise<Resultado<PruebaAcs>> {
        return resolver(api.POST('/api/v1/integraciones/acs/probar'))
    }

    return { ver, guardar, probar }
}
