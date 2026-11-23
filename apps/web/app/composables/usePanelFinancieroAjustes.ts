import type { Schema } from '@argosisp/contracts'

export type AjustesPanelFinanciero = Schema<'AjustesPanelFinanciero'>

/**
 * Ajustes del panel financiero de la empresa activa (A3, decisión 4 del PM): días de suspensión tras
 * los que un servicio cuenta como baja (60 de fábrica).
 */
export function usePanelFinancieroAjustes() {
    const api = useApi()

    /** `GET /panel-financiero/ajustes` (`panel_financiero.ver`): `version` 1 si nunca se guardó. */
    function ver(): Promise<Resultado<AjustesPanelFinanciero>> {
        return resolver(api.GET('/api/v1/panel-financiero/ajustes'))
    }

    /** `PUT /panel-financiero/ajustes` (`panel_financiero.configurar`): 1 a 365 días; 409 si `version` cambió. */
    function guardar(diasBaja: number, version: number): Promise<Resultado<AjustesPanelFinanciero>> {
        return resolver(api.PUT('/api/v1/panel-financiero/ajustes', {
            params: { header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: { dias_baja: diasBaja, version },
        }))
    }

    return { ver, guardar }
}
