import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
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
 * - Guarda el resumen del mes (asientos, debe, haber y movimiento por cuenta).
 */

export interface EntradaCerrarPeriodo {
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
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, 0])
        if (await periodoCerrado(t.trx, periodo)) {
            throw new Conflicto(
                `El periodo ${periodo.slice(0, 7)} ya está cerrado`,
                'periodo_cerrado',
                'Periodo cerrado',
            )
        }

        const resumen = await resumenDelMes(t.trx, periodo)
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cierres_mensuales')
            .insert({ periodo, cerrado_por: t.ctx.actor.id, resumen: JSON.stringify(resumen) })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('cierre_mensual', fila!.id)
        return verCierre(fila!.id, t.trx)
    }
}
