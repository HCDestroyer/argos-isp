import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
    verMovimiento,
    type CausaBaja,
    type MovimientoVista,
} from '#inventario/kardex'

/**
 * `inventario.dar_de_baja` (`POST /inventario/bajas`): existencias dañadas, robadas u obsoletas
 * (`causa`) con motivo. Sale al costo promedio; asiento `5.6.02 Mermas y faltantes / 1.1.14`. Fecha
 * de hoy. Más que la existencia: 409 `existencia_insuficiente`.
 */

export interface EntradaBaja {
    producto_id: number
    bodega_id: number
    cantidad: string
    causa: CausaBaja
    motivo: string
}

export default class DarDeBajaInventario extends DomainAction<EntradaBaja, MovimientoVista> {
    readonly nombre = 'inventario.dar_de_baja'

    protected async handle(input: EntradaBaja, t: Transaccion): Promise<MovimientoVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'La baja lleva su motivo', rule: 'required' },
            ])
        }
        const producto = await productoMovible(t, input.producto_id)
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        const bodega = await bodegaMovible(t, input.bodega_id, empresaId)
        const cantidad = cantidadValida(input.cantidad)
        await bloquearProducto(t, producto.id)
        const costo = costoSalida(await saldoDe(t, producto.id, bodega.id), cantidad, producto, bodega.id)
        const id = await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'baja',
                fecha: hoyGuatemala(),
                producto,
                bodegaId: bodega.id,
                cantidad: cantidad.neg(),
                costoTotal: costo.neg(),
                causa: input.causa,
                motivo,
            },
            {
                contrapartida: CUENTAS_GT.MERMAS_INVENTARIO,
                descripcion: `Baja de inventario (${input.causa}) de ${producto.sku} en ${bodega.nombre}: ${motivo}`,
            },
        )
        t.fijarEntidad('movimiento_inventario', id)
        return verMovimiento(id, t.trx)
    }
}
