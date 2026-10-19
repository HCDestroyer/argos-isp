import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { verEgreso, type EgresoVista } from '#ledger/egresos'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * `egresos.anular` (`POST /egresos/:id/anular`, con motivo): revierte el asiento del egreso con
 * `RevertirAsiento` (fecha de hoy: si el egreso es de un mes cerrado, el reverso cae en el periodo
 * abierto) y deja la anulación en `ledger.egresos_anulaciones`. El egreso nunca se edita ni se
 * borra. Un egreso en efectivo anulado deja de restar en el esperado de su turno si sigue abierto.
 * 409 `egreso_anulado` si ya estaba anulado.
 */

export interface EntradaAnularEgreso {
    egreso_id: number
    motivo: string
}

export default class AnularEgreso extends DomainAction<EntradaAnularEgreso, EgresoVista> {
    readonly nombre = 'egresos.anular'

    protected async handle(input: EntradaAnularEgreso, t: Transaccion): Promise<EgresoVista> {
        t.fijarEntidad('egreso', input.egreso_id)
        const egreso = await t.trx
            .from('ledger.egresos')
            .where('id', input.egreso_id)
            .select('id', 'empresa_id')
            .first()
        if (!egreso) throw new NoEncontrado(`El egreso ${input.egreso_id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(egreso.empresa_id))
        t.fijarEmpresa(Number(egreso.empresa_id))
        // dos anulaciones simultáneas: el índice único de egreso_id deja pasar una sola
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3004, input.egreso_id])
        const previa = await t.trx.from('ledger.egresos_anulaciones').where('egreso_id', egreso.id).first()
        if (previa) {
            throw new Conflicto(`El egreso ${egreso.id} ya está anulado`, 'egreso_anulado', 'Egreso anulado')
        }

        // fase 5 (§3.4): el egreso de una compra al contado se anula con la compra; y un egreso que
        // ya es una compra (desde egreso) se anula después de anular esa compra
        const compra = await t.trx.from('ledger.egresos').where('id', egreso.id).select('compra_id').first()
        if (compra?.compra_id) {
            throw new Conflicto(
                `El egreso ${egreso.id} paga la compra ${compra.compra_id}: anula la compra (POST /compras/${compra.compra_id}/anular)`,
                'egreso_de_compra',
                'Egreso de una compra',
            )
        }
        const comoCompra = await t.trx
            .from('ledger.compras as c')
            .where('c.egreso_id', egreso.id)
            .whereNotExists((q) => q.from('ledger.compras_anulaciones as x').whereRaw('x.compra_id = c.id'))
            .select('c.id')
            .first()
        if (comoCompra) {
            throw new Conflicto(
                `El egreso ${egreso.id} está registrado como la compra ${comoCompra.id}: anula primero la compra`,
                'egreso_con_compra',
                'Egreso con compra',
            )
        }

        const asiento = await t.trx
            .from('ledger.asientos')
            .where('origen_tipo', 'egreso')
            .where('origen_id', egreso.id)
            .whereNull('reversa_de')
            .select('id')
            .firstOrFail()
        const motivo = input.motivo.trim()
        const reverso = await new RevertirAsiento().execute(
            {
                asiento_id: asiento.id as number,
                motivo: `anulación del egreso ${egreso.id}: ${motivo}`,
                por_anulacion: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .insertQuery()
            .table('ledger.egresos_anulaciones')
            .insert({
                egreso_id: egreso.id,
                asiento_id: reverso.id,
                motivo,
                anulado_por: usuarioDelActor(t.ctx.actor),
            })
        return verEgreso(egreso.id, t.trx)
    }
}
