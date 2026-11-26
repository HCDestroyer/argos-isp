import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { LOCK_CONCILIACION, verConciliacion, type ConciliacionVista } from '#ledger/conciliacion'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * `bancos.anular_conciliacion` (`POST /bancos/conciliaciones/:id/anular`, permiso
 * `bancos.conciliar`): deshace la conciliación completa (todas las filas de su grupo) con una fila
 * por cada una en `ledger.conciliaciones_anulaciones` y el motivo. Solo inserción:
 *
 * - Lo que la conciliación **creó** se deshace con su reverso (plan de contabilidad, E11 y B3): la
 *   llegada de un depósito o un traslado en tránsito (`Banco / 1.1.11`) se revierte y deja su fila
 *   en `ledger.transitos_reatribuciones`, así el documento vuelve a estar en tránsito; el asiento de
 *   una diferencia (`diferencia_conciliacion`) se revierte y libera el tope del día.
 * - Lo que ya estaba en el libro (pagos, liquidaciones, la partida registrada desde el extracto)
 *   sigue ahí y vuelve a estar disponible para conciliar.
 * - 409 `conciliacion_anulada` si ya lo estaba.
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
        await this.deshacerLoCreado(
            t,
            filas.map((f) => Number(f.id)),
            Number(fila.cuenta_id),
            motivo,
        )
        return verConciliacion(input.conciliacion_id, t.trx)
    }

    /** Revierte las llegadas y las diferencias que nacieron con esta conciliación. */
    private async deshacerLoCreado(t: Transaccion, filas: number[], cuentaId: number, motivo: string) {
        const ligados = (await t.trx
            .from('ledger.conciliaciones as k')
            .join('ledger.movimientos as m', 'm.id', 'k.movimiento_id')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .whereIn('k.id', filas)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .select('k.linea_id', 'a.id as asiento_id', 'a.origen_tipo', 'a.origen_id', 'm.debe')) as Array<{
            linea_id: number
            asiento_id: number
            origen_tipo: string
            origen_id: number | null
            debe: string
        }>
        const texto = `conciliación deshecha: ${motivo}`
        for (const l of ligados) {
            if (l.origen_tipo === 'diferencia_conciliacion') {
                await new RevertirAsiento().execute(
                    { asiento_id: Number(l.asiento_id), motivo: texto, por_anulacion: true },
                    t.ctx,
                    { trx: t.trx },
                )
                continue
            }
            if ((l.origen_tipo !== 'deposito' && l.origen_tipo !== 'traslado') || l.origen_id === null) {
                continue
            }
            // ¿es la llegada (Banco debe / 1.1.11 haber) acreditada con esta línea?
            const llegada = (await t.trx
                .from('ledger.transitos_acreditados as x')
                .where({ 'x.tipo': l.origen_tipo, 'x.documento_id': l.origen_id, 'x.linea_id': l.linea_id })
                .where('x.cuenta_id', cuentaId)
                .whereNotExists((q) =>
                    q.from('ledger.transitos_reatribuciones as rr').whereRaw('rr.acreditado_id = x.id'),
                )
                .select('x.id', 'x.empresa_id')
                .first()) as { id: number; empresa_id: number } | null
            if (!llegada) continue
            const esLlegada = await t.trx
                .from('ledger.movimientos as mt')
                .join('ledger.cuentas as ct', 'ct.id', 'mt.cuenta_id')
                .where('mt.asiento_id', l.asiento_id)
                .where('ct.codigo', CUENTAS_GT.FONDOS_EN_TRANSITO)
                .where('mt.haber', '>', 0)
                .select('mt.id')
                .first()
            if (!esLlegada) continue
            const reverso = await new RevertirAsiento().execute(
                { asiento_id: Number(l.asiento_id), motivo: texto, por_anulacion: true },
                t.ctx,
                { trx: t.trx },
            )
            await t.trx
                .insertQuery()
                .table('ledger.transitos_reatribuciones')
                .insert({
                    empresa_id: Number(llegada.empresa_id),
                    acreditado_id: llegada.id,
                    asiento_reverso_id: reverso.id,
                    motivo: texto,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })
        }
    }
}
