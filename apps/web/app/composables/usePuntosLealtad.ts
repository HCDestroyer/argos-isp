import type { Schema, paths } from '@argosisp/contracts'

export type PuntosCliente = Schema<'PuntosCliente'>
export type SaldoPuntos = PuntosCliente['saldos'][number]
export type LotePuntos = Schema<'LotePuntos'>
export type MovimientoPuntos = Schema<'MovimientoPuntos'>
export type AjustePuntos = Schema<'AjustePuntos'>
export type DatosAjustePuntos = paths['/api/v1/lealtad/ajustes']['post']['requestBody']['content']['application/json']
export type ReporteLealtad = Schema<'ReporteLealtad'>

/**
 * Puntos de lealtad (A3, `contratos/lealtad.md` §3 y §15.1): el saldo es la suma de los
 * movimientos (solo inserción); se ganan por reglas o por ajuste manual con motivo. El reporte
 * compara el pasivo de los lotes vivos con el saldo de 2.1.10 (`cuadra`).
 */
export function usePuntosLealtad() {
    const api = useApi()

    /** `GET /clientes/:id/puntos` (`lealtad.ver`): saldos y lotes por empresa y movimientos por cursor. */
    function deCliente(clienteId: number, cursor?: string): Promise<Resultado<PuntosCliente>> {
        const query: { limit: number, cursor?: string } = { limit: 25 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/clientes/{id}/puntos', { params: { path: { id: clienteId }, query } }))
    }

    /** `POST /lealtad/ajustes` (`lealtad.ajustar`): puntos con signo y motivo; 422 `saldo_insuficiente`. */
    function ajustar(datos: DatosAjustePuntos, claveIdempotencia: string): Promise<Resultado<AjustePuntos>> {
        return resolver(api.POST('/api/v1/lealtad/ajustes', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `GET /reportes/lealtad` (`reportes.ver`): emitidos, canjeados, vencidos y pasivo por empresa. */
    function reporte(desde?: string, hasta?: string): Promise<Resultado<ReporteLealtad>> {
        const query: { desde?: string, hasta?: string } = {}
        if (desde) {
            query.desde = desde
        }
        if (hasta) {
            query.hasta = hasta
        }
        return resolver(api.GET('/api/v1/reportes/lealtad', { params: { query } }))
    }

    return { deCliente, ajustar, reporte }
}
