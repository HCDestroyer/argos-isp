import type { Schema, paths } from '@argosisp/contracts'

export type AjustesPanelFinanciero = Schema<'AjustesPanelFinanciero'>
export type CambiosPanelFinanciero = paths['/api/v1/panel-financiero/ajustes']['put']['requestBody']['content']['application/json']
export type AlertasPanelFinanciero = Schema<'AlertasPanel'>

/**
 * Ajustes del panel financiero de la empresa activa (A3, decisiones 4 y 12 del PM): días de
 * suspensión tras los que un servicio cuenta como baja (60 de fábrica) y el aviso de pequeño
 * contribuyente (encendido y sus umbrales, que son el parámetro fiscal `pc_alertas` de la empresa).
 */
export function usePanelFinancieroAjustes() {
    const api = useApi()

    /** `GET /panel-financiero/ajustes` (`panel_financiero.ver`): `version` 1 si nunca se guardó. */
    function ver(): Promise<Resultado<AjustesPanelFinanciero>> {
        return resolver(api.GET('/api/v1/panel-financiero/ajustes'))
    }

    /**
     * `PUT /panel-financiero/ajustes` (`panel_financiero.configurar`): cada campo ausente queda igual;
     * 409 si `version` cambió. Cambiar `aviso_pc_umbrales` exige además `fiscal.editar_parametros`
     * (403), 422 `localizacion_no_instalada` y 409 `vigencia_duplicada` si ya se cambiaron hoy.
     */
    function guardar(cambios: CambiosPanelFinanciero): Promise<Resultado<AjustesPanelFinanciero>> {
        return resolver(api.PUT('/api/v1/panel-financiero/ajustes', {
            params: { header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: cambios,
        }))
    }

    /**
     * `GET /panel-financiero/alertas` (`panel_financiero.ver`): por empresa, sus alertas, las
     * revisiones que fallaron y las que la empresa apagó (`apagadas`, decisión 12).
     */
    function alertas(): Promise<Resultado<AlertasPanelFinanciero>> {
        return resolver(api.GET('/api/v1/panel-financiero/alertas'))
    }

    return { ver, guardar, alertas }
}
