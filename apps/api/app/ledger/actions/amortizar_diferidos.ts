import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { fechaValida, inicioDeMes } from '#ledger/fechas'
import { fechaDeCuota, mesCerradoAnterior, sumarMeses } from '#ledger/activos'
import { LOCK_DIFERIDO, cuotaDiferida } from '#ledger/diferidos'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `libro.amortizar_diferidos` (cron diario `diferir` del `billing:worker`, con lock): devuelve a
 * gastos o ingresos la parte de cada mes de los diferimientos vigentes, **todo lo pendiente hasta
 * `hasta`** (por defecto el mes anterior al actual). Una cuota por diferimiento y mes (único):
 * repetirlo no duplica (contrato de localización fiscal §10.10).
 *
 * Asiento `diferido` (origen = el diferimiento), con la fecha del último día del mes (o hoy si ese
 * mes ya está cerrado): gasto `Gasto / 1.1.13`; ingreso `2.1.12 / Ingreso`. Solo deja fila de
 * auditoría si registró alguna cuota.
 */

export interface EntradaAmortizar {
    hasta?: string | null
    diferimiento_id?: number | null
    empresa_id?: number | null
}

export interface ResultadoAmortizar {
    hasta: string
    cuotas: number
    monto: string
    diferimientos: number[]
}

export default class AmortizarDiferidos extends DomainAction<EntradaAmortizar, ResultadoAmortizar> {
    readonly nombre = 'libro.amortizar_diferidos'

    protected auditarExito(salida: ResultadoAmortizar): boolean {
        return salida.cuotas > 0
    }

    protected async handle(input: EntradaAmortizar, t: Transaccion): Promise<ResultadoAmortizar> {
        const tope = mesCerradoAnterior()
        const hasta = input.hasta ? inicioDeMes(fechaValida(input.hasta, 'hasta')) : tope
        if (hasta > tope) {
            throw new ValidacionFallida([
                { field: 'hasta', message: 'Solo se amortizan meses terminados', rule: 'mes_terminado' },
            ])
        }
        const diferimientos = (await t.trx
            .from('ledger.diferimientos as d')
            .where('d.inicio', '<=', hasta)
            .if(input.diferimiento_id, (q) => q.where('d.id', input.diferimiento_id!))
            // solo las empresas del alcance de quien lo pide (el cron, sistema, ve todas)
            .if(t.ctx.empresasPermitidas, (q) => q.whereIn('d.empresa_id', t.ctx.empresasPermitidas!))
            .if(input.empresa_id, (q) => q.where('d.empresa_id', input.empresa_id!))
            .whereNotExists((q) =>
                q.from('ledger.diferimientos_cancelaciones as x').whereRaw('x.diferimiento_id = d.id'),
            )
            .orderBy('d.id')
            .select(
                'd.id',
                'd.empresa_id',
                'd.origen',
                'd.descripcion',
                'd.total',
                'd.meses',
                'd.cuenta_diferida_id',
                'd.cuenta_destino_id',
                t.trx.raw(`to_char(d.inicio, 'YYYY-MM-DD') as inicio`),
            )) as Array<{
            id: number
            empresa_id: number
            origen: 'factura' | 'compra'
            descripcion: string
            total: string
            meses: number
            cuenta_diferida_id: number
            cuenta_destino_id: number
            inicio: string
        }>
        let cuotas = 0
        let total: Dec = CERO
        const tocados: number[] = []
        for (const d of diferimientos) {
            const empresaId = Number(d.empresa_id)
            exigirAccesoEmpresa(t.ctx, empresaId)
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DIFERIDO, d.id])
            // con el lock: la anulación de su compra que terminó mientras esperaba lo canceló
            const cancelado = await t.trx
                .from('ledger.diferimientos_cancelaciones')
                .where('diferimiento_id', d.id)
                .first()
            if (cancelado) continue
            const hechas = (await t.trx
                .from('ledger.diferimientos_cuotas')
                .where('diferimiento_id', d.id)
                .select(t.trx.raw(`to_char(mes, 'YYYY-MM-DD') as mes`), 'monto')) as Array<{
                mes: string
                monto: string
            }>
            const meses = new Set(hechas.map((h) => h.mes))
            const importe = dec(d.total)
            let acumulado = hechas.reduce((s, h) => s.plus(h.monto), CERO)
            for (let numero = 1; numero <= Number(d.meses); numero++) {
                const mes = sumarMeses(d.inicio, numero - 1)
                if (mes > hasta) break
                if (meses.has(mes)) continue
                const monto = cuotaDiferida(importe, Number(d.meses), numero, acumulado)
                if (monto.lte(0)) break
                const gasto = d.origen === 'compra'
                const asiento = await new RegistrarAsiento().execute(
                    {
                        empresa_id: empresaId,
                        fecha: await fechaDeCuota(t.trx, mes, empresaId),
                        descripcion: `Diferido ${d.id} · ${mes.slice(0, 7)} (${numero}/${d.meses}) · ${d.descripcion}`,
                        origen_tipo: 'diferido',
                        origen_id: Number(d.id),
                        movimientos: gasto
                            ? [
                                  { cuenta: Number(d.cuenta_destino_id), debe: aTexto(monto) },
                                  { cuenta: Number(d.cuenta_diferida_id), haber: aTexto(monto) },
                              ]
                            : [
                                  { cuenta: Number(d.cuenta_diferida_id), debe: aTexto(monto) },
                                  { cuenta: Number(d.cuenta_destino_id), haber: aTexto(monto) },
                              ],
                    },
                    t.ctx,
                    { trx: t.trx },
                )
                await t.trx
                    .insertQuery()
                    .table('ledger.diferimientos_cuotas')
                    .insert({
                        diferimiento_id: d.id,
                        mes,
                        monto: aTexto(monto),
                        asiento_id: asiento.id,
                    })
                acumulado = acumulado.plus(monto)
                total = total.plus(monto)
                cuotas += 1
                if (!tocados.includes(Number(d.id))) tocados.push(Number(d.id))
            }
        }
        if (tocados.length === 1) t.fijarEntidad('diferimiento', tocados[0]!)
        return { hasta, cuotas, monto: aTexto(total), diferimientos: tocados }
    }
}
