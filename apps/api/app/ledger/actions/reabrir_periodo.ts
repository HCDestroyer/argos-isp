import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { PeriodoBloqueado, bloqueoVigente } from '#ledger/bloqueos'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { periodoDe, verCierre, type CierreVista } from '#ledger/cierres'
import { LOCK_CIERRES } from '#ledger/actions/cerrar_periodo'
import { ejercicioCerrado } from '#ledger/ejercicios'

/**
 * `libro.reabrir_periodo` (`POST /libro/periodos/reabrir`, permiso aparte de cerrar): reabre un
 * mes cerrado con motivo obligatorio. No borra el cierre: agrega una fila en
 * `ledger.reaperturas_mensuales` que apunta a él (queda la historia y la auditoría de la acción
 * con el motivo). Después se puede volver a cerrar (un cierre nuevo). 409 `periodo_abierto` si
 * el mes no está cerrado.
 *
 * Partidas del Libro Diario (decisión del líder): las ya asignadas nunca cambian y, al volver a
 * cerrar, los asientos nuevos del mes reciben las siguientes. Para que la secuencia anual no se
 * rompa, solo se reabre un mes si ningún mes posterior **cerrado** del mismo año tiene partidas:
 * 409 `reapertura_fuera_de_orden` (se reabren primero los posteriores, del más reciente hacia
 * atrás).
 *
 * Bajo el bloqueo duro (§9.2) ningún mes se reabre: 409 `bloqueo_duro`. Con el ejercicio del año
 * cerrado (§9.1), tampoco: 409 `ejercicio_cerrado` (se reabre el ejercicio).
 */

export interface EntradaReabrirPeriodo {
    /** empresa cuyo libro se reabre; por defecto la activa (o la única) */
    empresa_id?: number | null
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
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, empresaId])
        const duro = await bloqueoVigente(t.trx, empresaId, 'duro')
        if (duro !== null && periodo <= duro) {
            throw new PeriodoBloqueado('duro', periodo, duro, empresaId)
        }
        // con el ejercicio cerrado (§9.1) ningún mes del año se reabre: se reabre el ejercicio
        if (await ejercicioCerrado(t.trx, periodo, empresaId)) {
            throw new Conflicto(
                `El ejercicio ${input.anio} está cerrado: reabre el ejercicio (libro.reabrir_ejercicio) para reabrir ${periodo.slice(0, 7)}`,
                'ejercicio_cerrado',
                'Ejercicio cerrado',
            )
        }
        const cierre = await t.trx
            .from('ledger.cierres_mensuales as c')
            .where('c.periodo', periodo)
            .where('c.empresa_id', empresaId)
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
        const conPartidas = await t.trx.rawQuery(
            `SELECT DISTINCT to_char(date_trunc('month', a.fecha), 'YYYY-MM') AS mes
               FROM ledger.asientos_partidas p
               JOIN ledger.asientos a ON a.id = p.asiento_id
              WHERE p.empresa_id = ? AND p.anio = ?
                AND a.fecha >= (?::date + interval '1 month')
                AND ledger.periodo_cerrado(a.fecha, a.empresa_id)
              ORDER BY 1`,
            [empresaId, input.anio, periodo],
        )
        const posteriores = conPartidas.rows as Array<{ mes: string }>
        if (posteriores.length > 0) {
            throw new Conflicto(
                `No se puede reabrir ${periodo.slice(0, 7)}: ${posteriores.map((p) => p.mes).join(', ')} ` +
                    'ya tiene partidas del Libro Diario. Reabre primero los meses posteriores, del más reciente hacia atrás',
                'reapertura_fuera_de_orden',
                'Reapertura fuera de orden',
            )
        }
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
