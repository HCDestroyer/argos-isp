import type { Schema, paths } from '@argosisp/contracts'

export type ConfiguracionNotificaciones = Schema<'ConfiguracionNotificaciones'>
export type ResultadoPruebaCanal = Schema<'ResultadoPruebaCanal'>
export type CambiosConfiguracionNotificaciones = paths['/api/v1/notificaciones/configuracion/empresas/{empresaId}']['put']['requestBody']['content']['application/json']
export type PruebaCanal = paths['/api/v1/notificaciones/configuracion/probar']['post']['requestBody']['content']['application/json']

/**
 * Configuración de canales de notificación (A6, `contratos/multiempresa.md`): la global y la de cada
 * empresa (`hereda` = usa la global). Los secretos llegan como `***`: no mandar el campo los
 * conserva, texto los reemplaza y `null` los borra (nunca reenviar `***`: 422).
 * `empresaId = null` es la global.
 */
export function useNotificaciones() {
    const api = useApi()

    /** `GET` (`notificaciones.ver`) de la global o de una empresa (`sin_configurar` si no tiene). */
    function ver(empresaId: number | null): Promise<Resultado<ConfiguracionNotificaciones>> {
        return empresaId === null
            ? resolver(api.GET('/api/v1/notificaciones/configuracion'))
            : resolver(api.GET('/api/v1/notificaciones/configuracion/empresas/{empresaId}', { params: { path: { empresaId } } }))
    }

    /** `PUT` (`notificaciones.configurar`) con la `version` leída (0 la crea); 409 `conflicto_version`. */
    function guardar(empresaId: number | null, cambios: CambiosConfiguracionNotificaciones): Promise<Resultado<ConfiguracionNotificaciones>> {
        if (empresaId === null) {
            const { hereda: _hereda, ...global } = cambios
            return resolver(api.PUT('/api/v1/notificaciones/configuracion', { body: global }))
        }
        return resolver(api.PUT('/api/v1/notificaciones/configuracion/empresas/{empresaId}', { params: { path: { empresaId } }, body: cambios }))
    }

    /**
     * "Enviar prueba" (`notificaciones.probar`). Responde 200 aunque el envío falle: `estado`
     * `fallido` y `error` con el texto real del servidor SMTP o de la Bot API.
     */
    function probar(empresaId: number | null, prueba: PruebaCanal): Promise<Resultado<ResultadoPruebaCanal>> {
        return empresaId === null
            ? resolver(api.POST('/api/v1/notificaciones/configuracion/probar', { body: prueba }))
            : resolver(api.POST('/api/v1/notificaciones/configuracion/empresas/{empresaId}/probar', { params: { path: { empresaId } }, body: prueba }))
    }

    return { ver, guardar, probar }
}
