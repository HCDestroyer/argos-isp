import type { Schema } from '@argosisp/contracts'

export type PanelFinanciero = Schema<'PanelFinanciero'>
export type BloqueIngresoRecurrente = Schema<'BloqueIngresoRecurrente'>
export type BloqueBajasMes = Schema<'BloqueBajasMes'>
export type SeccionPanelFinanciero = PanelFinanciero['empresas'][number]
export type ReporteBajas = Schema<'ReporteBajas'>

/**
 * Cifras del panel financiero (A3, `panel_financiero.ver`): ingreso mensual recurrente (MRR), ingreso
 * promedio por servicio (ARPU), bajas del mes y efectivo. Cada bloque llega `ok`, `error` (con su
 * problema y sin cifras) o `no_aplica` (con su motivo, p. ej. el régimen de la empresa).
 */
export function usePanelFinanciero() {
    const api = useApi()

    /**
     * `GET /panel-financiero`: una sección por empresa (la activa; con `todas`, todas y `total`). El
     * mes de las bajas es el actual si no se pide otro (`YYYY-MM`).
     */
    function ver(opciones: { mes?: string, todas?: boolean } = {}): Promise<Resultado<PanelFinanciero>> {
        const query: { mes?: string, empresas?: 'todas' } = {}
        if (opciones.mes) {
            query.mes = opciones.mes
        }
        if (opciones.todas) {
            query.empresas = 'todas'
        }
        return resolver(api.GET('/api/v1/panel-financiero', { params: { query } }))
    }

    /** `GET /reportes/bajas` (`panel_financiero.ver`): altas y bajas por mes (12 de fábrica). */
    function bajas(opciones: { desde?: string, hasta?: string, todas?: boolean } = {}): Promise<Resultado<ReporteBajas>> {
        const query: { desde?: string, hasta?: string, empresas?: 'todas' } = {}
        if (opciones.desde) {
            query.desde = opciones.desde
        }
        if (opciones.hasta) {
            query.hasta = opciones.hasta
        }
        if (opciones.todas) {
            query.empresas = 'todas'
        }
        return resolver(api.GET('/api/v1/reportes/bajas', { params: { query } }))
    }

    return { ver, bajas }
}
