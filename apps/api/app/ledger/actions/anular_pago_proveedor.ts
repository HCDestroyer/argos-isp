import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verPagoProveedor, type PagoProveedorVista } from '#ledger/pagos_proveedores'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { LOCK_COMPRA } from '#ledger/actions/registrar_pago_proveedor'

/**
 * `compras.anular_pago` (`POST /pagos-proveedores/:id/anular`, permiso `compras.pagar`, con
 * motivo): revierte el asiento del pago (fecha de hoy) y deja la fila en
 * `ledger.pagos_proveedores_anulaciones`. Sus compras vuelven a quedar con saldo. 409
 * `pago_anulado` si ya lo estaba.
 */

export interface EntradaAnularPagoProveedor {
    pago_id: number
    motivo: string
}

export default class AnularPagoProveedor extends DomainAction<
    EntradaAnularPagoProveedor,
    PagoProveedorVista
> {
    readonly nombre = 'compras.anular_pago'

    protected async handle(input: EntradaAnularPagoProveedor, t: Transaccion): Promise<PagoProveedorVista> {
        t.fijarEntidad('pago_proveedor', input.pago_id)
        const pago = await t.trx
            .from('ledger.pagos_proveedores')
            .where('id', input.pago_id)
            .select('id', 'empresa_id')
            .first()
        if (!pago) throw new NoEncontrado(`El pago a proveedor ${input.pago_id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(pago.empresa_id))
        t.fijarEmpresa(Number(pago.empresa_id))
        const compras = (await t.trx
            .from('ledger.pagos_proveedores_aplicaciones')
            .where('pago_id', pago.id)
            .orderBy('compra_id')
            .select('compra_id')) as Array<{ compra_id: number }>
        for (const c of compras) {
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_COMPRA, c.compra_id])
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3013, pago.id])
        const previa = await t.trx
            .from('ledger.pagos_proveedores_anulaciones')
            .where('pago_id', pago.id)
            .first()
        if (previa) {
            throw new Conflicto(
                `El pago a proveedor ${pago.id} ya está anulado`,
                'pago_anulado',
                'Pago anulado',
            )
        }

        const asiento = await t.trx
            .from('ledger.asientos')
            .where({ origen_tipo: 'pago_proveedor', origen_id: pago.id })
            .whereNull('reversa_de')
            .select('id')
            .firstOrFail()
        const motivo = input.motivo.trim()
        const reverso = await new RevertirAsiento().execute(
            {
                asiento_id: Number(asiento.id),
                motivo: `anulación del pago a proveedor ${pago.id}: ${motivo}`,
                por_anulacion: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .insertQuery()
            .table('ledger.pagos_proveedores_anulaciones')
            .insert({
                pago_id: pago.id,
                asiento_id: reverso.id,
                motivo,
                anulado_por: usuarioDelActor(t.ctx.actor),
            })
        return verPagoProveedor(Number(pago.id), t.trx)
    }
}
