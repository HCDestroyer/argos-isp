import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { PeriodoBloqueado, bloqueoVigente, motivoObligatorio } from '#ledger/bloqueos'
import { periodoCerrado } from '#ledger/cierres'
import { anioValido, cierreVigente, verCierreAnual, type CierreAnualVista } from '#ledger/ejercicios'
import { LOCK_CIERRES } from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * `libro.reabrir_ejercicio` (`POST /libro/ejercicios/reabrir`, solo `admin`; contrato §9.1): reabre
 * un ejercicio cerrado con motivo obligatorio.
 *
 * - Bajo el bloqueo duro que cubre el 31-dic del año: 409 `bloqueo_duro`. Si el año siguiente ya
 *   tiene cierre vigente: 409 `reapertura_fuera_de_orden` (se reabre del más reciente hacia atrás).
 *   Sin cierre vigente: 409 `ejercicio_abierto`.
 * - Agrega `ledger.reaperturas_anuales` (el cierre no se borra), reabre diciembre (`reabrir_periodo`
 *   anidada, con el mismo motivo) y revierte cada asiento del cierre **con fecha 31-dic** (desvío de
 *   §9.1, que dice «con fecha de hoy»: un reverso con fecha de hoy devolvería los ingresos y gastos
 *   del año cerrado al año en curso y el libro del 31-dic quedaría cancelado dos veces al volver a
 *   cerrar). Diciembre queda abierto para corregir y volver a cerrar con `libro.cerrar_ejercicio`.
 * - Emite `libro.ejercicio_reabierto`.
 */

export interface EntradaReabrirEjercicio {
    empresa_id?: number | null
    anio: number
    motivo: string
}

export default class ReabrirEjercicio extends DomainAction<EntradaReabrirEjercicio, CierreAnualVista> {
    readonly nombre = 'libro.reabrir_ejercicio'

    protected async handle(input: EntradaReabrirEjercicio, t: Transaccion): Promise<CierreAnualVista> {
        const anio = anioValido(input.anio)
        const motivo = motivoObligatorio(input.motivo)
        const fin = `${anio}-12-31`
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, empresaId])

        const duro = await bloqueoVigente(t.trx, empresaId, 'duro')
        if (duro !== null && fin <= duro) throw new PeriodoBloqueado('duro', fin, duro, empresaId)
        const cierreId = await cierreVigente(t.trx, empresaId, anio)
        if (cierreId === null) {
            throw new Conflicto(`El ejercicio ${anio} no está cerrado`, 'ejercicio_abierto', 'Ejercicio abierto')
        }
        t.fijarEntidad('cierre_anual', cierreId)
        if ((await cierreVigente(t.trx, empresaId, anio + 1)) !== null) {
            throw new Conflicto(
                `No se puede reabrir ${anio}: el ejercicio ${anio + 1} está cerrado. Reábrelo primero`,
                'reapertura_fuera_de_orden',
                'Reapertura fuera de orden',
            )
        }

        await t.trx
            .insertQuery()
            .table('ledger.reaperturas_anuales')
            .insert({ cierre_id: cierreId, motivo, reabierto_por: usuarioDelActor(t.ctx.actor) })

        if (await periodoCerrado(t.trx, `${anio}-12-01`, empresaId)) {
            await new ReabrirPeriodo().execute(
                { empresa_id: empresaId, anio, mes: 12, motivo: `Reapertura del ejercicio ${anio}: ${motivo}` },
                t.ctx,
                { trx: t.trx },
            )
        }

        // los asientos del cierre, del último al primero, con fecha 31-dic
        const asientos = (await t.trx
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'cierre_anual')
            .where('a.origen_id', cierreId)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .orderBy('a.id', 'desc')
            .select('a.id')) as Array<{ id: number }>
        for (const a of asientos) {
            await new RevertirAsiento().execute(
                {
                    asiento_id: Number(a.id),
                    motivo: `reapertura del ejercicio ${anio}: ${motivo}`,
                    fecha: fin,
                    por_anulacion: true,
                },
                t.ctx,
                { trx: t.trx },
            )
        }

        await t.emit('libro.ejercicio_reabierto', { empresa_id: empresaId, cierre_id: cierreId, anio, motivo })
        return verCierreAnual(cierreId, t.trx)
    }
}
