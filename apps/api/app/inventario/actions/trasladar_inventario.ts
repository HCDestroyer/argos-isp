import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    exigirSeguimiento,
    insertarMovimiento,
    productoMovible,
    saldoDe,
    verMovimiento,
    type MovimientoVista,
} from '#inventario/kardex'
import { actualizarUnidad, unidadesDeBodega } from '#inventario/unidades'

/**
 * `inventario.trasladar` (`POST /inventario/traslados`): de una bodega a otra (o a la de un técnico)
 * de la misma empresa (una bodega de otra empresa responde 404: un traslado entre empresas no
 * existe, §2). Sin asiento (misma cuenta `1.1.14`). Fecha de hoy.
 *
 * - Por cantidad: dos movimientos con el mismo `traslado_id`; sale del origen al costo promedio y
 *   entra al destino al mismo costo. 409 `existencia_insuficiente`.
 * - Por serie (`unidad_ids`): un par de movimientos por unidad, a su costo, con el mismo
 *   `traslado_id`; la unidad cambia de bodega. Una en comodato: 409 `unidad_en_comodato`; en otra
 *   bodega: 409 `unidad_en_otra_bodega`.
 */

export interface EntradaTraslado {
    producto_id: number
    bodega_origen_id: number
    bodega_destino_id: number
    cantidad?: string | null
    unidad_ids?: number[] | null
    motivo?: string | null
}

export interface TrasladoVista {
    traslado_id: number
    /** el primer par (en un traslado por cantidad, el único) */
    salida: MovimientoVista
    entrada: MovimientoVista
    /** todos los movimientos del traslado, salida y entrada de cada unidad */
    movimientos: MovimientoVista[]
}

export default class TrasladarInventario extends DomainAction<EntradaTraslado, TrasladoVista> {
    readonly nombre = 'inventario.trasladar'

    protected async handle(input: EntradaTraslado, t: Transaccion): Promise<TrasladoVista> {
        const producto = await productoMovible(t, input.producto_id)
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        const ids = input.unidad_ids ?? []
        exigirSeguimiento(producto, ids.length > 0, ids.length > 0 ? 'unidad_ids' : 'cantidad')
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
        await bloquearProducto(t, producto.id)
        const { rows } = (await t.trx.rawQuery(
            `SELECT nextval('inventario.traslados_seq')::bigint AS id`,
        )) as {
            rows: Array<{ id: string }>
        }
        const trasladoId = Number(rows[0]!.id)
        const comun = {
            empresaId,
            tipo: 'traslado' as const,
            fecha: hoyGuatemala(),
            producto,
            trasladoId,
            motivo: input.motivo ?? null,
            avisarMinimo: false,
        }
        const pares: Array<[number, number]> = []
        if (ids.length > 0) {
            const unidades = await unidadesDeBodega(t, ids, {
                empresaId,
                productoId: producto.id,
                bodegaId: origen.id,
            })
            for (const unidad of unidades) {
                const costo = dec(unidad.costo)
                const salida = await insertarMovimiento(t, {
                    ...comun,
                    bodegaId: origen.id,
                    cantidad: dec('-1'),
                    costoTotal: costo.neg(),
                    unidadId: unidad.id,
                })
                await actualizarUnidad(t, unidad.id, { bodega_id: destino.id })
                const entrada = await insertarMovimiento(t, {
                    ...comun,
                    bodegaId: destino.id,
                    cantidad: dec('1'),
                    costoTotal: costo,
                    unidadId: unidad.id,
                })
                pares.push([salida, entrada])
            }
        } else {
            const cantidad = cantidadValida(input.cantidad ?? '')
            const costo = costoSalida(await saldoDe(t, producto.id, origen.id), cantidad, producto, origen.id)
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
            pares.push([salida, entrada])
        }
        t.fijarEntidad('traslado_inventario', trasladoId)
        const movimientos: MovimientoVista[] = []
        for (const [salida, entrada] of pares) {
            movimientos.push(await verMovimiento(salida, t.trx), await verMovimiento(entrada, t.trx))
        }
        return { traslado_id: trasladoId, salida: movimientos[0]!, entrada: movimientos[1]!, movimientos }
    }
}
