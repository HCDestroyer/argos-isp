import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { bloquearCliente } from '#billing/cobros'
import { columnasFactura, type FacturaFila } from '#billing/facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * `facturas.anular` (`POST /facturas/:id/anular`, permiso `facturas.anular`, con motivo).
 *
 * - 409 `factura_con_pagos` si la factura (o una de sus moras) tiene pagos aplicados: hay que
 *   anular el pago primero. 409 `factura_anulada` si ya estaba anulada.
 * - Pasa a `anulada` con quién/cuándo/motivo; nunca se borra. Sus recargos de mora pendientes
 *   se anulan con ella (cada uno con su reverso y su evento).
 * - Revierte su asiento (`factura` o `mora`) con `RevertirAsiento`: el saldo del cliente baja.
 * - Evento `factura.anulada` y re-evaluación del servicio: si ya no le quedan vencidas, se
 *   reactiva en la misma transacción.
 * - La `clave_unica` del periodo sigue ocupada: `generarFacturas` no vuelve a emitir ese periodo.
 */

export interface EntradaAnularFactura {
    factura_id: number
    motivo: string
}

export default class AnularFactura extends DomainAction<EntradaAnularFactura, FacturaFila> {
    readonly nombre = 'facturas.anular'

    protected async handle(input: EntradaAnularFactura, t: Transaccion): Promise<FacturaFila> {
        t.fijarEntidad('factura', input.factura_id)
        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)

        const facturas = (await t.trx
            .from('billing.facturas')
            .where((q) => q.where('id', input.factura_id).orWhere('factura_origen_id', input.factura_id))
            .orderBy('id', 'asc')
            .forUpdate()
            .select(
                'id',
                'cliente_id',
                'servicio_id',
                'tipo',
                'estado',
                'total',
                'pagado',
                t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            )) as Array<{
            id: number
            cliente_id: number
            servicio_id: number | null
            tipo: 'servicio' | 'mora'
            estado: string
            total: string
            pagado: string
            vence_en: string
        }>
        const factura = facturas.find((f) => f.id === input.factura_id)!
        if (factura.estado === 'anulada') {
            throw new Conflicto(
                `La factura ${factura.id} ya está anulada`,
                'factura_anulada',
                'Factura anulada',
            )
        }
        const conPagos = facturas.filter((f) => f.estado !== 'anulada' && dec(f.pagado).gt(0))
        if (conPagos.length > 0) {
            throw new Conflicto(
                `La factura ${factura.id} tiene pagos aplicados (${conPagos
                    .map((f) => `factura ${f.id}: Q${f.pagado}`)
                    .join(', ')}); anula primero el pago`,
                'factura_con_pagos',
                'Factura con pagos',
            )
        }

        const motivo = input.motivo.trim()
        const anular = facturas.filter((f) => f.estado !== 'anulada')
        for (const f of anular) {
            const asientos = (await t.trx
                .from('ledger.asientos as a')
                .where('a.origen_tipo', f.tipo === 'mora' ? 'mora' : 'factura')
                .where('a.origen_id', f.id)
                .whereNull('a.reversa_de')
                .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
                .orderBy('a.id', 'asc')
                .select('a.id')) as Array<{ id: number }>
            for (const asiento of asientos) {
                await new RevertirAsiento().execute(
                    { asiento_id: asiento.id, motivo: `anulación de la factura ${f.id}: ${motivo}` },
                    t.ctx,
                    { trx: t.trx },
                )
            }
            await t.trx
                .from('billing.facturas')
                .where('id', f.id)
                .update({
                    estado: 'anulada',
                    anulada_en: t.trx.knexRawQuery('now()'),
                    anulada_por: t.ctx.actor.id,
                    motivo_anulacion:
                        f.id === factura.id ? motivo : `anulación de la factura ${factura.id}: ${motivo}`,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'factura', id: f.id },
                { estado: f.estado },
                { estado: 'anulada' },
            )
            await t.emit('factura.anulada', {
                factura_id: f.id,
                servicio_id: f.servicio_id,
                cliente_id: f.cliente_id,
                total: f.total,
                vence: f.vence_en,
            })
        }
        t.fijarEntidad('factura', factura.id)

        if (factura.servicio_id) {
            await new EvaluarEstadoServicio().execute({ servicio_id: factura.servicio_id }, t.ctx, {
                trx: t.trx,
            })
        }
        const fila = (await t.trx
            .from('billing.facturas as f')
            .where('f.id', factura.id)
            .select(...columnasFactura(t.trx))
            .firstOrFail()) as FacturaFila
        return fila
    }
}
