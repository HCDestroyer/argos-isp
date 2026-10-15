import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import type { MetodoPago } from '#shared/eventos'
import { dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import {
    aplicarAnticipos,
    bloquearCliente,
    serviciosDe,
    sumarAPagado,
    type FacturaPendiente,
} from '#billing/cobros'
import { verPago, type PagoVista } from '#billing/pagos'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * `pagos.anular` (`POST /pagos/:id/anular`, permiso `pagos.anular`, con motivo).
 *
 * - El pago pasa a `anulado` (con quién, cuándo y por qué); nunca se borra ni se edita su monto.
 * - Cada asiento del pago (el del cobro y los de aplicación de su anticipo) se revierte con
 *   `RevertirAsiento` (asiento espejo con `reversa_de`).
 * - Lo aplicado se descuenta de cada factura y su estado se recalcula (`vencida` si ya había
 *   vencido). Las filas de `pagos_aplicaciones` quedan como historia del pago anulado.
 * - Evento `pago.anulado`; luego aplica otros anticipos del cliente si los hay y re-evalúa cada
 *   servicio afectado (puede volver a limitar o cortar, respetando la hora de corte).
 */

export interface EntradaAnularPago {
    pago_id: number
    motivo: string
}

export default class AnularPago extends DomainAction<EntradaAnularPago, PagoVista> {
    readonly nombre = 'pagos.anular'

    protected async handle(input: EntradaAnularPago, t: Transaccion): Promise<PagoVista> {
        t.fijarEntidad('pago', input.pago_id)
        const previo = await t.trx
            .from('billing.pagos')
            .where('id', input.pago_id)
            .select('cliente_id')
            .first()
        if (!previo) throw new NoEncontrado(`El pago ${input.pago_id} no existe`)
        await bloquearCliente(t.trx, previo.cliente_id)

        const pago = (await t.trx
            .from('billing.pagos')
            .where('id', input.pago_id)
            .forUpdate()
            .select('id', 'cliente_id', 'metodo', 'monto', 'estado')
            .firstOrFail()) as {
            id: number
            cliente_id: number
            metodo: MetodoPago
            monto: string
            estado: string
        }
        if (pago.estado === 'anulado') {
            throw new ReglaNegocio(`El pago ${pago.id} ya está anulado`, 'pago_anulado')
        }

        const aplicaciones = (await t.trx
            .from('billing.pagos_aplicaciones')
            .where('pago_id', pago.id)
            .groupBy('factura_id')
            .select('factura_id', t.trx.raw('sum(monto)::text as monto'))) as Array<{
            factura_id: number
            monto: string
        }>
        const facturas = (await t.trx
            .from('billing.facturas')
            .whereIn(
                'id',
                aplicaciones.map((a) => a.factura_id),
            )
            .orderBy('id', 'asc')
            .forUpdate()
            .select('id', 'servicio_id', 'total', 'pagado', 'vencida_en')) as FacturaPendiente[]
        for (const factura of facturas) {
            const aplicado = aplicaciones.find((a) => a.factura_id === factura.id)!
            await sumarAPagado(t.trx, factura, dec(aplicado.monto).negated())
        }

        const asientos = (await t.trx
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'pago')
            .where('a.origen_id', pago.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .orderBy('a.id', 'asc')
            .select('a.id')) as Array<{ id: number }>
        for (const asiento of asientos) {
            await new RevertirAsiento().execute(
                { asiento_id: asiento.id, motivo: `anulación del pago ${pago.id}: ${input.motivo}` },
                t.ctx,
                { trx: t.trx },
            )
        }

        await t.trx
            .from('billing.pagos')
            .where('id', pago.id)
            .update({
                estado: 'anulado',
                anulado_en: t.trx.knexRawQuery('now()'),
                anulado_por: t.ctx.actor.id,
                motivo_anulacion: input.motivo.trim(),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)

        await t.emit('pago.anulado', {
            pago_id: pago.id,
            cliente_id: pago.cliente_id,
            monto: pago.monto,
            metodo: pago.metodo,
            facturas: aplicaciones.map((a) => a.factura_id),
        })

        const otras = await aplicarAnticipos(t, pago.cliente_id)
        for (const servicioId of serviciosDe([...facturas, ...otras])) {
            await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, t.ctx, { trx: t.trx })
        }
        return verPago(pago.id, t.trx)
    }
}
