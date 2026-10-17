import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { asignarPartidas } from '#ledger/diarios'
import { periodoCerrado, periodoDe, resumenDelMes, verCierre, type CierreVista } from '#ledger/cierres'

/**
 * `libro.cerrar_periodo` = `cerrarPeriodo(año, mes)` (`POST /libro/periodos/cerrar`).
 *
 * Después del cierre ningún asiento puede tener fecha dentro del mes, ni siquiera un reverso: los
 * reversos (`RevertirAsiento`) van con la fecha de hoy, que cae en el periodo abierto. Se aplica
 * en la acción (`registrarAsiento` consulta `ledger.periodo_cerrado`) y en la base de datos
 * (triggers de asientos y movimientos).
 *
 * - Solo meses ya terminados (Guatemala): 422 `periodo_en_curso` para el mes actual o futuro.
 * - 409 `periodo_cerrado` si ya está cerrado (también lo impide un trigger).
 * - Por empresa (multiempresa): cierra el libro de `empresa_id` (por defecto la activa); los demás
 *   libros siguen abiertos.
 * - Guarda el resumen del mes (asientos, debe, haber y movimiento por cuenta).
 * - Asigna la partida del Libro Diario a los asientos del mes que aún no la tienen
 *   (`ledger.asientos_partidas`, correlativo por empresa y año en orden `(fecha, numero)`). Un mes
 *   reabierto conserva sus partidas: nunca se renumera.
 */

export interface EntradaCerrarPeriodo {
    /** empresa cuyo libro se cierra; por defecto la activa (o la única) */
    empresa_id?: number | null
    anio: number
    mes: number
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

/** Espacio de advisory locks de cierres (primer entero). */
export const LOCK_CIERRES = 3005

export default class CerrarPeriodo extends DomainAction<EntradaCerrarPeriodo, CierreVista> {
    readonly nombre = 'libro.cerrar_periodo'

    protected async handle(input: EntradaCerrarPeriodo, t: Transaccion): Promise<CierreVista> {
        const periodo = periodoDe(input.anio, input.mes)
        if (periodo >= inicioDeMes(hoyGuatemala(input.ahora))) {
            throw new ReglaNegocio(
                `El periodo ${periodo.slice(0, 7)} no ha terminado: solo se cierran meses pasados`,
                'periodo_en_curso',
            )
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, empresaId])
        if (await periodoCerrado(t.trx, periodo, empresaId)) {
            throw new Conflicto(
                `El periodo ${periodo.slice(0, 7)} ya está cerrado`,
                'periodo_cerrado',
                'Periodo cerrado',
            )
        }

        const resumen = await resumenDelMes(t.trx, periodo, empresaId)
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cierres_mensuales')
            .insert({
                empresa_id: empresaId,
                periodo,
                cerrado_por: usuarioDelActor(t.ctx.actor),
                resumen: JSON.stringify(resumen),
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('cierre_mensual', fila!.id)
        await asignarPartidas(t.trx, empresaId, periodo, fila!.id)
        return verCierre(fila!.id, t.trx)
    }
}
