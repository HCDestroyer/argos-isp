import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { bd } from '../bd'

/**
 * Lo que `GET /facturas/:id` agrega a la factura (`verFactura` de A3): los pagos aplicados (una fila por
 * aplicación, también las de pagos anulados), los asientos de origen factura o mora con sus reversos y
 * el tope de diferencia de cobro de la empresa (`diferencia_cobro_tope`, Q1.00 por defecto).
 */
export function extrasDetalle(facturaId: number): Pick<Schema<'FacturaDetalle'>, 'pagos' | 'asientos' | 'diferencia_cobro_tope'> {
    const pagos: Schema<'FacturaPagoAplicado'>[] = []
    for (const pago of bd.pagos) {
        pago.aplicaciones.forEach((aplicacion, indice) => {
            if (aplicacion.factura_id !== facturaId) {
                return
            }
            pagos.push({
                aplicacion_id: pago.id * 100 + indice,
                pago_id: pago.id,
                cobro_id: pago.cobro_id,
                monto: aplicacion.monto,
                pago_monto: pago.monto,
                metodo: pago.metodo,
                referencia: pago.referencia ?? null,
                estado: pago.estado,
                historico: pago.historico ?? false,
                aplicado_en: pago.created_at,
            })
        })
    }
    const asientos: Schema<'FacturaAsiento'>[] = bd.asientos
        .filter(a => (a.origen_tipo === 'factura' || a.origen_tipo === 'mora') && a.origen_id === facturaId)
        .map(a => ({
            id: a.id,
            fecha: a.fecha,
            origen_tipo: a.origen_tipo as 'factura' | 'mora',
            descripcion: a.descripcion,
            diario: a.diario,
            numero: a.numero ?? null,
            total: a.movimientos.reduce((s, m) => s.plus(m.debe), new Decimal(0)).toFixed(2),
            reversa_de: a.reversa_de,
            revertido_por: bd.asientos.find(r => r.reversa_de === a.id)?.id ?? null,
        }))
    return { pagos, asientos, diferencia_cobro_tope: '1.00' }
}
