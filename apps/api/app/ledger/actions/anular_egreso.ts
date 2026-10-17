import { DomainAction, type Transaccion } from '#shared/domain_action'
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
        const egreso = await t.trx.from('ledger.egresos').where('id', input.egreso_id).select('id').first()
        if (!egreso) throw new NoEncontrado(`El egreso ${input.egreso_id} no existe`)
        // dos anulaciones simultáneas: el índice único de egreso_id deja pasar una sola
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3004, input.egreso_id])
        const previa = await t.trx.from('ledger.egresos_anulaciones').where('egreso_id', egreso.id).first()
        if (previa) {
            throw new Conflicto(`El egreso ${egreso.id} ya está anulado`, 'egreso_anulado', 'Egreso anulado')
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
        await t.trx.insertQuery().table('ledger.egresos_anulaciones').insert({
            egreso_id: egreso.id,
            asiento_id: reverso.id,
            motivo,
            anulado_por: t.ctx.actor.id,
        })
        return verEgreso(egreso.id, t.trx)
    }
}
