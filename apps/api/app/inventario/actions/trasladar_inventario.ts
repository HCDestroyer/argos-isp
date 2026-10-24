import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    insertarMovimiento,
    productoMovible,
    saldoDe,
    verMovimiento,
    type MovimientoVista,
} from '#inventario/kardex'

/**
 * `inventario.trasladar` (`POST /inventario/traslados`): de una bodega a otra (o a la de un técnico)
 * de la misma empresa (una bodega de otra empresa responde 404: un traslado entre empresas no
 * existe, §2). Dos movimientos con el mismo `traslado_id`: sale del origen al costo promedio y entra
 * al destino al mismo costo. Sin asiento (misma cuenta `1.1.14`). Fecha de hoy. Más que la
 * existencia: 409 `existencia_insuficiente`.
 */

export interface EntradaTraslado {
    producto_id: number
    bodega_origen_id: number
    bodega_destino_id: number
    cantidad: string
    motivo?: string | null
}

export interface TrasladoVista {
    traslado_id: number
    salida: MovimientoVista
    entrada: MovimientoVista
}

export default class TrasladarInventario extends DomainAction<EntradaTraslado, TrasladoVista> {
    readonly nombre = 'inventario.trasladar'

    protected async handle(input: EntradaTraslado, t: Transaccion): Promise<TrasladoVista> {
        const producto = await productoMovible(t, input.producto_id)
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        if (input.bodega_origen_id === input.bodega_destino_id) {
            throw new ValidacionFallida([
                { field: 'bodega_destino_id', message: 'El destino es otra bodega', rule: 'distinta' },
            ])
        }
        const origen = await bodegaMovible(t, input.bodega_origen_id, empresaId, {
            campo: 'bodega_origen_id',
        })
        const destino = await bodegaMovible(t, input.bodega_destino_id, empresaId, {
            campo: 'bodega_destino_id',
            entrada: true,
        })
        const cantidad = cantidadValida(input.cantidad)
        await bloquearProducto(t, producto.id)
        const costo = costoSalida(await saldoDe(t, producto.id, origen.id), cantidad, producto, origen.id)
        const { rows } = (await t.trx.rawQuery(
            `SELECT nextval('inventario.traslados_seq')::bigint AS id`,
        )) as {
            rows: Array<{ id: string }>
        }
        const trasladoId = Number(rows[0]!.id)
        const fecha = hoyGuatemala()
        const comun = {
            empresaId,
            tipo: 'traslado' as const,
            fecha,
            producto,
            trasladoId,
            motivo: input.motivo ?? null,
            avisarMinimo: false,
        }
        const salida = await insertarMovimiento(t, {
            ...comun,
            bodegaId: origen.id,
            cantidad: cantidad.neg(),
            costoTotal: costo.neg(),
        })
        const entrada = await insertarMovimiento(t, {
            ...comun,
            bodegaId: destino.id,
            cantidad,
            costoTotal: costo,
        })
        t.fijarEntidad('traslado_inventario', trasladoId)
        return {
            traslado_id: trasladoId,
            salida: await verMovimiento(salida, t.trx),
            entrada: await verMovimiento(entrada, t.trx),
        }
    }
}
