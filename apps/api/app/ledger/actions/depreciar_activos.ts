import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { fechaValida, inicioDeMes } from '#ledger/fechas'
import { LOCK_ACTIVO, cuotaMensual, fechaDeCuota, mesCerradoAnterior, sumarMeses } from '#ledger/activos'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `activos.depreciar` (cron diario `depreciar` del `billing:worker`, con lock; también la llama
 * `activos.dar_de_baja`): registra **todo lo pendiente hasta el mes `hasta`** (por defecto el mes
 * anterior al actual), una cuota por activo y mes (único `activo_id, mes`): repetirlo no duplica.
 *
 * Asiento `depreciacion` (origen = el activo): `5.3.01 Depreciaciones / 1.2.02.NN` con la fecha del
 * último día del mes (o hoy, si ese mes ya está cerrado). Un activo dado de baja no se deprecia.
 * Solo deja fila de auditoría si registró alguna cuota.
 */

export interface EntradaDepreciar {
    /** último mes a depreciar (cualquier día); por defecto el mes anterior al actual */
    hasta?: string | null
    activo_id?: number | null
    empresa_id?: number | null
    /** interno (baja): también un activo con baja en curso */
    incluir_baja?: boolean
}

export interface ResultadoDepreciar {
    hasta: string
    cuotas: number
    monto: string
    activos: number[]
}

export default class DepreciarActivos extends DomainAction<EntradaDepreciar, ResultadoDepreciar> {
    readonly nombre = 'activos.depreciar'

    protected auditarExito(salida: ResultadoDepreciar): boolean {
        return salida.cuotas > 0
    }

    protected async handle(input: EntradaDepreciar, t: Transaccion): Promise<ResultadoDepreciar> {
        const tope = mesCerradoAnterior()
        const hasta = input.hasta ? inicioDeMes(fechaValida(input.hasta, 'hasta')) : tope
        if (hasta > tope) {
            throw new ValidacionFallida([
                { field: 'hasta', message: 'Solo se deprecian meses terminados', rule: 'mes_terminado' },
            ])
        }
        const activos = (await t.trx
            .from('ledger.activos as ac')
            .where('ac.inicio_depreciacion', '<=', hasta)
            .if(input.activo_id, (q) => q.where('ac.id', input.activo_id!))
            .if(input.empresa_id, (q) => q.where('ac.empresa_id', input.empresa_id!))
            // solo las empresas del alcance de quien lo pide (el cron, sistema, ve todas)
            .if(t.ctx.empresasPermitidas, (q) => q.whereIn('ac.empresa_id', t.ctx.empresasPermitidas!))
            .if(!input.incluir_baja, (q) =>
                q.whereNotExists((x) => x.from('ledger.activos_bajas as b').whereRaw('b.activo_id = ac.id')),
            )
            .orderBy('ac.id')
            .select(
                'ac.id',
                'ac.empresa_id',
                'ac.descripcion',
                'ac.costo',
                'ac.valor_residual',
                'ac.depreciacion_inicial',
                'ac.tasa_anual',
                'ac.cuenta_depreciacion_id',
                'ac.cuenta_gasto_id',
                t.trx.raw(`to_char(ac.inicio_depreciacion, 'YYYY-MM-DD') as inicio`),
            )) as Array<{
            id: number
            empresa_id: number
            descripcion: string
            costo: string
            valor_residual: string
            depreciacion_inicial: string
            tasa_anual: string
            cuenta_depreciacion_id: number
            cuenta_gasto_id: number
            inicio: string
        }>
        let cuotas = 0
        let total: Dec = CERO
        const tocados: number[] = []
        for (const activo of activos) {
            const empresaId = Number(activo.empresa_id)
            exigirAccesoEmpresa(t.ctx, empresaId)
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ACTIVO, activo.id])
            // con el lock: una baja o la anulación de su compra que terminó mientras esperaba
            if (!input.incluir_baja) {
                const baja = await t.trx.from('ledger.activos_bajas').where('activo_id', activo.id).first()
                if (baja) continue
            }
            const hechas = (await t.trx
                .from('ledger.activos_cuotas')
                .where('activo_id', activo.id)
                .select(t.trx.raw(`to_char(mes, 'YYYY-MM-DD') as mes`), 'monto')) as Array<{
                mes: string
                monto: string
            }>
            const meses = new Set(hechas.map((h) => h.mes))
            let restante = dec(activo.costo)
                .minus(activo.valor_residual)
                .minus(activo.depreciacion_inicial)
                .minus(hechas.reduce((s, h) => s.plus(h.monto), CERO))
            const cuota = cuotaMensual(activo)
            for (let mes = activo.inicio; mes <= hasta && restante.gt(0); mes = sumarMeses(mes, 1)) {
                if (meses.has(mes)) continue
                const monto = cuota.lt(restante) && cuota.gt(0) ? cuota : restante
                const asiento = await new RegistrarAsiento().execute(
                    {
                        empresa_id: empresaId,
                        fecha: fechaDeCuota(mes),
                        trasladar_si_bloqueado: true,
                        descripcion: `Depreciación ${mes.slice(0, 7)} del activo ${activo.id} · ${activo.descripcion}`,
                        origen_tipo: 'depreciacion',
                        origen_id: Number(activo.id),
                        movimientos: [
                            { cuenta: Number(activo.cuenta_gasto_id), debe: aTexto(monto) },
                            { cuenta: Number(activo.cuenta_depreciacion_id), haber: aTexto(monto) },
                        ],
                    },
                    t.ctx,
                    { trx: t.trx },
                )
                await t.trx
                    .insertQuery()
                    .table('ledger.activos_cuotas')
                    .insert({
                        activo_id: activo.id,
                        mes,
                        monto: aTexto(monto),
                        asiento_id: asiento.id,
                    })
                restante = restante.minus(monto)
                total = total.plus(monto)
                cuotas += 1
                if (!tocados.includes(Number(activo.id))) tocados.push(Number(activo.id))
            }
        }
        if (tocados.length === 1) t.fijarEntidad('activo', tocados[0]!)
        return { hasta, cuotas, monto: aTexto(total), activos: tocados }
    }
}
