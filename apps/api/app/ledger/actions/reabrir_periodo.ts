import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { periodoDe, verCierre, type CierreVista } from '#ledger/cierres'
import { LOCK_CIERRES } from '#ledger/actions/cerrar_periodo'

/**
 * `libro.reabrir_periodo` (`POST /libro/periodos/reabrir`, permiso aparte de cerrar): reabre un
 * mes cerrado con motivo obligatorio. No borra el cierre: agrega una fila en
 * `ledger.reaperturas_mensuales` que apunta a él (queda la historia y la auditoría de la acción
 * con el motivo). Después se puede volver a cerrar (un cierre nuevo). 409 `periodo_abierto` si
 * el mes no está cerrado.
 */

export interface EntradaReabrirPeriodo {
    anio: number
    mes: number
    motivo: string
}

export default class ReabrirPeriodo extends DomainAction<EntradaReabrirPeriodo, CierreVista> {
    readonly nombre = 'libro.reabrir_periodo'

    protected async handle(input: EntradaReabrirPeriodo, t: Transaccion): Promise<CierreVista> {
        const periodo = periodoDe(input.anio, input.mes)
        const motivo = input.motivo?.trim()
        if (!motivo || motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, 0])
        const cierre = await t.trx
            .from('ledger.cierres_mensuales as c')
            .where('c.periodo', periodo)
            .whereNotExists((q) => q.from('ledger.reaperturas_mensuales as r').whereRaw('r.cierre_id = c.id'))
            .select('c.id')
            .first()
        if (!cierre) {
            throw new Conflicto(
                `El periodo ${periodo.slice(0, 7)} no está cerrado`,
                'periodo_abierto',
                'Periodo abierto',
            )
        }
        t.fijarEntidad('cierre_mensual', cierre.id as number)
        await t.trx
            .insertQuery()
            .table('ledger.reaperturas_mensuales')
            .insert({
                cierre_id: cierre.id,
                motivo,
                reabierto_por: usuarioDelActor(t.ctx.actor),
            })
        return verCierre(cierre.id as number, t.trx)
    }
}
