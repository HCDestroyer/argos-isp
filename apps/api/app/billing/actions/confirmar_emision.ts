import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { fechaValida } from '#ledger/fechas'
import { bloquearCliente } from '#billing/cobros'
import { contabilizarFactura } from '#billing/emision'

/**
 * `facturas.confirmar_emision`: una factura `por_certificar` (FEL obligatoria con
 * `certificar_al = emitir`, contrato §8.3) se emite al certificarse su DTE. La llama
 * `fel.certificar_dte`, anidada, con la fecha de certificación.
 *
 * - Pasa a `emitida`, escribe su asiento con la fecha de certificación (o el primer día abierto si
 *   ese mes ya se cerró), emite `factura.emitida` y aplica los anticipos del cliente. Desde aquí
 *   cuenta para el corte como cualquier factura.
 * - 409 `factura_no_por_certificar` si ya no lo está (idempotente para quien reintenta: el DTE ya
 *   se certificó una vez).
 */

export interface EntradaConfirmarEmision {
    factura_id: number
    /** fecha de certificación en Guatemala, YYYY-MM-DD */
    fecha: string
}

export default class ConfirmarEmision extends DomainAction<EntradaConfirmarEmision, { factura_id: number }> {
    readonly nombre = 'facturas.confirmar_emision'

    protected async handle(input: EntradaConfirmarEmision, t: Transaccion) {
        const fecha = fechaValida(input.fecha, 'fecha')
        t.fijarEntidad('factura', input.factura_id)
        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)
        const f = (await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'estado',
                'total',
                'aviso_cobro',
                t.trx.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
                t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            )
            .firstOrFail()) as {
            id: number
            empresa_id: number
            cliente_id: number
            servicio_id: number | null
            estado: string
            total: string
            aviso_cobro: boolean
            periodo: string
            vence_en: string
        }
        const empresaId = Number(f.empresa_id)
        t.fijarEmpresa(empresaId)
        if (f.estado !== 'por_certificar') {
            throw new Conflicto(
                `La factura ${f.id} no está por certificar (estado ${f.estado})`,
                'factura_no_por_certificar',
                'Factura ya emitida',
            )
        }
        await t.trx
            .from('billing.facturas')
            .where('id', f.id)
            .update({
                estado: 'emitida',
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'factura', id: f.id },
            { estado: 'por_certificar' },
            { estado: 'emitida' },
        )
        await contabilizarFactura(t, {
            id: f.id,
            empresa_id: empresaId,
            cliente_id: f.cliente_id,
            servicio_id: f.servicio_id,
            total: f.total,
            vence_en: f.vence_en,
            aviso_cobro: f.aviso_cobro,
            descripcion: `servicio ${f.servicio_id ?? '-'} · periodo ${f.periodo} (certificada)`,
            fecha,
        })
        return { factura_id: f.id }
    }
}
