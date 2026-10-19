import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { LOCK_CONCILIACION, verConciliacion, type ConciliacionVista } from '#ledger/conciliacion'

/**
 * `bancos.anular_conciliacion` (`POST /bancos/conciliaciones/:id/anular`, permiso
 * `bancos.conciliar`): deshace la conciliación completa (todas las filas de su grupo) con una fila
 * por cada una en `ledger.conciliaciones_anulaciones` y el motivo. **No toca el libro**: los
 * asientos que la conciliación ligó (incluida la llegada de un depósito o un traslado, o la
 * partida registrada desde el extracto) siguen ahí y vuelven a estar disponibles para conciliar.
 * 409 `conciliacion_anulada` si ya lo estaba.
 */

export interface EntradaAnularConciliacion {
    conciliacion_id: number
    motivo: string
}

export default class AnularConciliacion extends DomainAction<EntradaAnularConciliacion, ConciliacionVista> {
    readonly nombre = 'bancos.anular_conciliacion'

    protected async handle(input: EntradaAnularConciliacion, t: Transaccion): Promise<ConciliacionVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        const fila = (await t.trx
            .from('ledger.conciliaciones')
            .where('id', input.conciliacion_id)
            .select('grupo', 'empresa_id', 'cuenta_id')
            .first()) as { grupo: string; empresa_id: number; cuenta_id: number } | null
        if (!fila) throw new NoEncontrado(`La conciliación ${input.conciliacion_id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
        t.fijarEmpresa(Number(fila.empresa_id))
        t.fijarEntidad('conciliacion', input.conciliacion_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_CONCILIACION, fila.cuenta_id])
        const filas = (await t.trx
            .from('ledger.conciliaciones as k')
            .where('k.grupo', fila.grupo)
            .select(
                'k.id',
                t.trx.raw(
                    'EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id) as anulada',
                ),
            )) as Array<{ id: number; anulada: boolean }>
        if (filas.some((f) => f.anulada)) {
            throw new Conflicto(
                `La conciliación ${input.conciliacion_id} ya está anulada`,
                'conciliacion_anulada',
                'Conciliación anulada',
            )
        }
        await t.trx
            .insertQuery()
            .table('ledger.conciliaciones_anulaciones')
            .multiInsert(
                filas.map((f) => ({
                    conciliacion_id: f.id,
                    motivo,
                    anulado_por: usuarioDelActor(t.ctx.actor),
                })),
            )
        return verConciliacion(input.conciliacion_id, t.trx)
    }
}
