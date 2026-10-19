import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { listarReglas, reglaCoincide, type ReglaConciliacionVista } from '#ledger/conciliacion'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'

/**
 * `bancos.aplicar_reglas` (`POST /bancos/extractos/:id/aplicar-reglas`, permiso
 * `bancos.conciliar`): pasa las reglas activas de la empresa (por prioridad) sobre las líneas sin
 * conciliar del extracto. La primera regla que coincide decide:
 *
 * - `contrapartida`: `bancos.registrar_desde_extracto` con la cuenta de la regla (asiento nuevo y
 *   conciliación).
 * - `cliente`: el pago bancario vigente (depósito, transferencia, ACH, remesa) de la empresa con la
 *   misma referencia que la línea, cuyo movimiento en la cuenta del extracto vale lo mismo que la
 *   línea y está sin conciliar; si hay exactamente uno, se concilia. Si no, la línea queda para
 *   conciliarse a mano.
 *
 * Cada conciliación guarda su `regla_id`. Nada se reescribe.
 */

export interface EntradaAplicarReglas {
    extracto_id: number
}

export interface ResultadoAplicarReglas {
    extracto_id: number
    conciliadas: Array<{
        linea_id: number
        regla_id: number
        accion: 'contrapartida' | 'cliente'
        conciliacion_id: number
    }>
    /** líneas a las que una regla aplicó pero no encontró su pago */
    sin_pago: number[]
    /** líneas sin conciliar a las que ninguna regla aplicó */
    sin_regla: number[]
}

export default class AplicarReglasConciliacion extends DomainAction<
    EntradaAplicarReglas,
    ResultadoAplicarReglas
> {
    readonly nombre = 'bancos.aplicar_reglas'

    protected async handle(input: EntradaAplicarReglas, t: Transaccion): Promise<ResultadoAplicarReglas> {
        const extracto = (await t.trx
            .from('ledger.extractos')
            .where('id', input.extracto_id)
            .select('id', 'empresa_id', 'cuenta_id')
            .first()) as { id: number; empresa_id: number; cuenta_id: number } | null
        if (!extracto) throw new NoEncontrado(`El extracto ${input.extracto_id} no existe`)
        const empresaId = Number(extracto.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('extracto', extracto.id)

        const todas = await listarReglas([empresaId], t.trx)
        const reglas = todas.filter((r) => r.activa)
        const lineas = (await t.trx
            .from('ledger.extractos_lineas as l')
            .where('l.extracto_id', extracto.id)
            .whereNotExists((q) =>
                q
                    .from('ledger.conciliaciones as k')
                    .whereRaw('k.linea_id = l.id')
                    .whereNotExists((x) =>
                        x.from('ledger.conciliaciones_anulaciones as a').whereRaw('a.conciliacion_id = k.id'),
                    ),
            )
            .orderBy('l.orden')
            .select('l.id', 'l.cuenta_id', 'l.descripcion', 'l.referencia', 'l.monto')) as Array<{
            id: number
            cuenta_id: number
            descripcion: string
            referencia: string | null
            monto: string
        }>
        const resultado: ResultadoAplicarReglas = {
            extracto_id: extracto.id,
            conciliadas: [],
            sin_pago: [],
            sin_regla: [],
        }
        for (const linea of lineas) {
            const regla = reglas.find((r) => reglaCoincide(r, linea))
            if (!regla) {
                resultado.sin_regla.push(Number(linea.id))
                continue
            }
            const conciliacion = await this.aplicar(t, regla, linea, empresaId)
            if (conciliacion === null) resultado.sin_pago.push(Number(linea.id))
            else {
                resultado.conciliadas.push({
                    linea_id: Number(linea.id),
                    regla_id: Number(regla.id),
                    accion: regla.accion,
                    conciliacion_id: conciliacion,
                })
            }
        }
        return resultado
    }

    private async aplicar(
        t: Transaccion,
        regla: ReglaConciliacionVista,
        linea: { id: number; cuenta_id: number; referencia: string | null; monto: string },
        empresaId: number,
    ): Promise<number | null> {
        if (regla.accion === 'contrapartida') {
            const r = await new RegistrarDesdeExtracto().execute(
                { linea_id: Number(linea.id), cuenta: regla.contrapartida, regla_id: Number(regla.id) },
                t.ctx,
                { trx: t.trx },
            )
            return r.id
        }
        const referencia = linea.referencia?.trim()
        if (!referencia) return null
        const candidatos = (await t.trx
            .from('billing.pagos as p')
            .join('ledger.asientos as a', (j) =>
                j.on('a.origen_id', 'p.id').andOnVal('a.origen_tipo', 'pago'),
            )
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .where('p.empresa_id', empresaId)
            .where('p.estado', 'registrado')
            .whereIn('p.metodo', ['deposito', 'transferencia', 'ach', 'remesa'])
            .whereRaw('lower(btrim(p.referencia)) = lower(?)', [referencia])
            .whereNull('a.reversa_de')
            .where('m.cuenta_id', linea.cuenta_id)
            .whereRaw('(m.debe - m.haber) = ?::numeric', [linea.monto])
            .whereNotExists((q) =>
                q
                    .from('ledger.conciliaciones as k')
                    .whereRaw('k.movimiento_id = m.id')
                    .whereNotExists((x) =>
                        x
                            .from('ledger.conciliaciones_anulaciones as an')
                            .whereRaw('an.conciliacion_id = k.id'),
                    ),
            )
            .select('m.id')) as Array<{ id: number }>
        if (candidatos.length !== 1) return null
        const r = await new ConciliarLinea().execute(
            {
                linea_id: Number(linea.id),
                movimientos: [Number(candidatos[0]!.id)],
                regla_id: Number(regla.id),
            },
            t.ctx,
            { trx: t.trx },
        )
        return r.id
    }
}
