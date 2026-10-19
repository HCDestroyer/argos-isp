import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { verEgreso, type EgresoVista } from '#ledger/egresos'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * `egresos.anular` (`POST /egresos/:id/anular`, con motivo): revierte el asiento del egreso con
 * `RevertirAsiento` (fecha de hoy: si el egreso es de un mes cerrado, el reverso cae en el periodo
 * abierto) y deja la anulación en `ledger.egresos_anulaciones`. El egreso nunca se edita ni se
 * borra. Un egreso en efectivo anulado deja de restar en el esperado de su turno si sigue abierto.
 * 409 `egreso_anulado` si ya estaba anulado. 422 `egreso_de_premio_sorteo` si es el egreso de un premio
 * de sorteo entregado (H22: se anula con `sorteos.anular_entrega`).
 */

export interface EntradaAnularEgreso {
    egreso_id: number
    motivo: string
    /** interno: solo desde `sorteos.anular_entrega` (el egreso de un premio en efectivo) */
    por_entrega_anulada?: boolean
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

        // H22: el egreso de un premio de sorteo entregado se anula solo con la entrega
        const premio = (await t.trx
            .from('lealtad.sorteos_ganadores')
            .where('egreso_id', egreso.id)
            .where('estado', 'entregado')
            .select('id', 'sorteo_id')
            .first()) as { id: number; sorteo_id: number } | null
        if (premio && !input.por_entrega_anulada) {
            throw new ReglaNegocio(
                `El egreso ${egreso.id} es el premio del ganador ${premio.id} del sorteo ${premio.sorteo_id}: se anula con su entrega (POST /lealtad/sorteos/${premio.sorteo_id}/ganadores/${premio.id}/anular-entrega)`,
                'egreso_de_premio_sorteo',
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
