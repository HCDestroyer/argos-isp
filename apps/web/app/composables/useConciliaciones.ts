import type { Schema, paths } from '@argosisp/contracts'

export type Conciliacion = Schema<'Conciliacion'>
export type MovimientoSinConciliar = Schema<'MovimientoSinConciliar'>
export type MovimientoConciliado = Schema<'MovimientoConciliado'>
export type ResumenConciliacionBancaria = Schema<'ResumenConciliacionBancaria'>
export type PartidaEnTransito = Schema<'PartidaEnTransito'>
export type DatosConciliacion = paths['/api/v1/bancos/conciliaciones']['post']['requestBody']['content']['application/json']

/**
 * Conciliación bancaria (A3, fase 4 §10.3): liga una línea del extracto con movimientos del libro,
 * depósitos o traslados en tránsito. Nunca reescribe asientos; deshacer deja una fila de anulación
 * con motivo. El reporte compara libro y extracto con sus partidas en tránsito.
 */
export function useConciliaciones() {
    const api = useApi()

    /** `GET /bancos/movimientos-sin-conciliar?cuenta_id` (`bancos.ver`). */
    function sinConciliar(cuentaId: number, hasta?: string): Promise<Resultado<MovimientoSinConciliar[]>> {
        const query: { cuenta_id: number, hasta?: string } = { cuenta_id: cuentaId }
        if (hasta) {
            query.hasta = hasta
        }
        return resolver(api.GET('/api/v1/bancos/movimientos-sin-conciliar', { params: { query } }))
    }

    /**
     * `POST /bancos/conciliaciones` (`bancos.conciliar`): 422 `conciliacion_descuadrada`, 409
     * `linea_conciliada` y `movimiento_conciliado`.
     */
    function conciliar(datos: DatosConciliacion, claveIdempotencia: string): Promise<Resultado<Conciliacion>> {
        return resolver(api.POST('/api/v1/bancos/conciliaciones', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `POST /bancos/conciliaciones/:id/anular` con motivo: deshace el grupo entero (409 `conciliacion_anulada`). */
    function anular(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Conciliacion>> {
        return resolver(api.POST('/api/v1/bancos/conciliaciones/{id}/anular', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /** `GET /reportes/conciliacion-bancaria?cuenta_id&fecha` (`reportes.ver`): una fila por cuenta. */
    function reporte(cuentaId?: number, fecha?: string): Promise<Resultado<ResumenConciliacionBancaria[]>> {
        const query: { cuenta_id?: number, fecha?: string } = {}
        if (cuentaId) {
            query.cuenta_id = cuentaId
        }
        if (fecha) {
            query.fecha = fecha
        }
        return resolver(api.GET('/api/v1/reportes/conciliacion-bancaria', { params: { query } }))
    }

    return { sinConciliar, conciliar, anular, reporte }
}
