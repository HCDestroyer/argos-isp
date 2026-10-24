import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTA_CONSUMO_POR_DEFECTO } from '#inventario/productos'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    exigirSeguimiento,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
    verMovimiento,
    type MovimientoVista,
} from '#inventario/kardex'

/**
 * `inventario.consumir` (`POST /inventario/consumos`): materiales usados en una instalación o una
 * reparación (`servicio_id` opcional, de la misma empresa). Sale de la bodega al costo promedio;
 * asiento `cuenta_consumo` del producto (por defecto `5.2.07`) / `1.1.14`. Fecha de hoy. Más que la
 * existencia: 409 `existencia_insuficiente` sin escribir nada.
 */

export interface EntradaConsumo {
    producto_id: number
    bodega_id: number
    cantidad: string
    servicio_id?: number | null
    motivo?: string | null
}

export default class ConsumirInventario extends DomainAction<EntradaConsumo, MovimientoVista> {
    readonly nombre = 'inventario.consumir'

    protected async handle(input: EntradaConsumo, t: Transaccion): Promise<MovimientoVista> {
        const producto = await productoMovible(t, input.producto_id)
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        // un equipo de serie no se consume: se presta en comodato o se da de baja
        exigirSeguimiento(producto, false)
        const bodega = await bodegaMovible(t, input.bodega_id, empresaId)
        const cantidad = cantidadValida(input.cantidad)
        if (input.servicio_id) {
            const servicio = await t.trx
                .from('core.servicios')
                .where({ id: input.servicio_id, empresa_id: empresaId })
                .select('id')
                .first()
            if (!servicio) {
                throw new NoEncontrado(`El servicio ${input.servicio_id} no existe en esta empresa`)
            }
        }
        await bloquearProducto(t, producto.id)
        const costo = costoSalida(await saldoDe(t, producto.id, bodega.id), cantidad, producto, bodega.id)
        const id = await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'consumo',
                fecha: hoyGuatemala(),
                producto,
                bodegaId: bodega.id,
                cantidad: cantidad.neg(),
                costoTotal: costo.neg(),
                servicioId: input.servicio_id ?? null,
                motivo: input.motivo ?? null,
            },
            {
                contrapartida: producto.cuenta_consumo ?? CUENTA_CONSUMO_POR_DEFECTO,
                descripcion: `Consumo de ${producto.sku} · ${producto.nombre} (${bodega.nombre})${input.servicio_id ? ` · servicio ${input.servicio_id}` : ''}`,
            },
        )
        t.fijarEntidad('movimiento_inventario', id)
        return verMovimiento(id, t.trx)
    }
}
