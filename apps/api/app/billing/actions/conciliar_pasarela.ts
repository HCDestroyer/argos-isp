import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { aTexto, dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, fechaValida, hoyGuatemala } from '#ledger/fechas'
import { pasarela, proveedorConfigurado, PasarelaNoConfigurada } from '#billing/pasarelas/pasarela'

/**
 * `pasarela.conciliar` (cron `conciliar` del `billing-worker`, una vez al día con lock; y
 * `POST /pasarela/conciliar`): compara lo que dice el proveedor (`consultar`) con nuestros cobros y
 * pagos `pasarela` del día (Guatemala; por defecto ayer) y guarda la corrida con sus diferencias.
 *
 * | Diferencia | Qué significa |
 * | --- | --- |
 * | `pago_sin_registrar` | el proveedor cobró y no tenemos el pago (webhook perdido) |
 * | `pago_sin_cobro_en_proveedor` | tenemos el pago y el proveedor no lo da por pagado |
 * | `monto_distinto` | el monto pagado no coincide |
 * | `pago_anulado` | el proveedor cobró pero el pago está anulado |
 * | `pago_sin_cobro` | pago `pasarela` del día sin cobro en línea |
 * | `error_consulta` | el proveedor no respondió por ese cobro |
 *
 * Solo reporta: no registra ni anula pagos (eso lo decide una persona). Los cobros que cuadran
 * quedan con `conciliado_en`.
 */

export interface EntradaConciliar {
    fecha?: string
}

export interface Diferencia {
    tipo: string
    cobro_id: number | null
    pago_id: number | null
    id_proveedor: string | null
    nuestro: string | null
    proveedor: string | null
    detalle: string
}

export interface ResultadoConciliacion {
    id: number
    proveedor: string
    fecha: string
    revisados: number
    conciliados: number
    /** cobros que cuadraron (quedan con `conciliado_en`) */
    cobros_conciliados: number[]
    diferencias: Diferencia[]
}

export default class ConciliarPasarela extends DomainAction<EntradaConciliar, ResultadoConciliacion> {
    readonly nombre = 'pasarela.conciliar'

    protected async handle(input: EntradaConciliar, t: Transaccion): Promise<ResultadoConciliacion> {
        const proveedor = proveedorConfigurado()
        if (!proveedor) throw new PasarelaNoConfigurada()
        const adaptador = await pasarela(proveedor)
        const fecha = input.fecha
            ? fechaValida(input.fecha)
            : DateTime.fromISO(hoyGuatemala(), { zone: ZONA_NEGOCIO }).minus({ days: 1 }).toISODate()!
        const dia = (columna: string) => `(${columna} AT TIME ZONE '${ZONA_NEGOCIO}')::date = ?::date`

        const cobros = (await t.trx
            .from('billing.pasarela_cobros as pc')
            .leftJoin('billing.pagos as p', 'p.id', 'pc.pago_id')
            .where('pc.proveedor', proveedor)
            .whereNotNull('pc.id_proveedor')
            .where((q) => q.whereRaw(dia('pc.created_at'), [fecha]).orWhereRaw(dia('pc.pagado_en'), [fecha]))
            .orderBy('pc.id', 'asc')
            .select(
                'pc.id',
                'pc.id_proveedor',
                'pc.pago_id',
                'p.monto as pago_monto',
                'p.estado as pago_estado',
            )) as Array<{
            id: number
            id_proveedor: string
            pago_id: number | null
            pago_monto: string | null
            pago_estado: string | null
        }>

        const diferencias: Diferencia[] = []
        const conciliados: number[] = []
        for (const cobro of cobros) {
            const comun = { cobro_id: cobro.id, pago_id: cobro.pago_id, id_proveedor: cobro.id_proveedor }
            let remoto
            try {
                remoto = await adaptador.consultar(cobro.id_proveedor)
            } catch (error) {
                diferencias.push({
                    ...comun,
                    tipo: 'error_consulta',
                    nuestro: null,
                    proveedor: null,
                    detalle: (error as Error).message,
                })
                continue
            }
            const pagadoRemoto = remoto.estado === 'pagado'
            const vigente = cobro.pago_id !== null && cobro.pago_estado !== 'anulado'
            if (pagadoRemoto && cobro.pago_id === null) {
                diferencias.push({
                    ...comun,
                    tipo: 'pago_sin_registrar',
                    nuestro: null,
                    proveedor: remoto.monto_pagado,
                    detalle: 'El proveedor cobró y no hay pago registrado (¿webhook perdido?)',
                })
            } else if (pagadoRemoto && !vigente) {
                diferencias.push({
                    ...comun,
                    tipo: 'pago_anulado',
                    nuestro: cobro.pago_monto,
                    proveedor: remoto.monto_pagado,
                    detalle: 'El proveedor cobró pero el pago está anulado',
                })
            } else if (!pagadoRemoto && vigente) {
                diferencias.push({
                    ...comun,
                    tipo: 'pago_sin_cobro_en_proveedor',
                    nuestro: cobro.pago_monto,
                    proveedor: null,
                    detalle: `El proveedor dice ${remoto.estado}`,
                })
            } else if (
                pagadoRemoto &&
                !dec(remoto.monto_pagado ?? '0').equals(dec(cobro.pago_monto ?? '0'))
            ) {
                diferencias.push({
                    ...comun,
                    tipo: 'monto_distinto',
                    nuestro: aTexto(cobro.pago_monto ?? '0'),
                    proveedor: aTexto(remoto.monto_pagado ?? '0'),
                    detalle: 'El monto pagado no coincide',
                })
            } else if (pagadoRemoto) {
                conciliados.push(cobro.id)
            }
        }

        const sueltos = (await t.trx
            .from('billing.pagos as p')
            .where('p.metodo', 'pasarela')
            .where('p.pasarela', proveedor)
            .whereNot('p.estado', 'anulado')
            .whereRaw(dia('p.created_at'), [fecha])
            .whereNotExists((q) => q.from('billing.pasarela_cobros as pc').whereRaw('pc.pago_id = p.id'))
            .select('p.id', 'p.monto', 'p.referencia')) as Array<{
            id: number
            monto: string
            referencia: string | null
        }>
        for (const pago of sueltos) {
            diferencias.push({
                tipo: 'pago_sin_cobro',
                cobro_id: null,
                pago_id: pago.id,
                id_proveedor: pago.referencia,
                nuestro: pago.monto,
                proveedor: null,
                detalle: 'Pago por pasarela sin cobro en línea',
            })
        }

        if (conciliados.length > 0) {
            await t.trx
                .from('billing.pasarela_cobros')
                .whereIn('id', conciliados)
                .whereNull('conciliado_en')
                .update({ conciliado_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.pasarela_conciliaciones')
            .insert({
                proveedor,
                fecha,
                revisados: cobros.length,
                conciliados: conciliados.length,
                diferencias: JSON.stringify(diferencias),
                cobros_conciliados: t.trx.raw('?::bigint[]', [`{${conciliados.join(',')}}`]),
                ejecutado_por: t.ctx.actor.id,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('conciliacion_pasarela', fila!.id)
        return {
            id: fila!.id,
            proveedor,
            fecha,
            revisados: cobros.length,
            conciliados: conciliados.length,
            cobros_conciliados: conciliados,
            diferencias,
        }
    }
}
