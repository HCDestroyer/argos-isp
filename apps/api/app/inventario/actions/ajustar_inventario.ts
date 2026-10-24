import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { dec, redondear, type Dec } from '#ledger/dinero'
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
    type MovimientoVista,
} from '#inventario/kardex'

/**
 * `inventario.ajustar` (`POST /inventario/ajustes`): ajuste manual con motivo obligatorio, como un
 * conteo (§5). `cantidad` con signo:
 *
 * - **Faltante** (negativa): sale al costo promedio; `5.6.02 Mermas y faltantes / 1.1.14`. Más que la
 *   existencia: 409 `existencia_insuficiente`.
 * - **Sobrante** (positiva): entra al último costo promedio (el de la bodega; sin existencia, el del
 *   último movimiento del producto) o al `costo_unitario` dado; `1.1.14 / 4.2.04 Sobrantes`. Sin
 *   costo conocido ni dado: 422 `costo_requerido`.
 *
 * Fecha de hoy; respeta los bloqueos de siempre.
 */

export interface EntradaAjuste {
    producto_id: number
    bodega_id: number
    cantidad: string
    motivo: string
    costo_unitario?: string | null
}

/** Último costo promedio del producto: el de la bodega o el del último movimiento del producto. */
async function ultimoCosto(t: Transaccion, productoId: number, bodegaId: number): Promise<Dec | null> {
    const saldo = await saldoDe(t, productoId, bodegaId)
    if (saldo.cantidad.gt(0)) return saldo.valor.div(saldo.cantidad)
    const ultimo = (await t.trx
        .from('inventario.movimientos')
        .where('producto_id', productoId)
        .where('costo_unitario', '>', 0)
        .orderBy('id', 'desc')
        .select('costo_unitario')
        .first()) as { costo_unitario: string } | null
    return ultimo ? dec(ultimo.costo_unitario) : null
}

export default class AjustarInventario extends DomainAction<EntradaAjuste, MovimientoVista> {
    readonly nombre = 'inventario.ajustar'

    protected async handle(input: EntradaAjuste, t: Transaccion): Promise<MovimientoVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El ajuste lleva su motivo', rule: 'required' },
            ])
        }
        const cantidad = cantidadValida(input.cantidad, 'cantidad', true)
        const entra = cantidad.gt(0)
        const producto = await productoMovible(t, input.producto_id, { entrada: entra })
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        const bodega = await bodegaMovible(t, input.bodega_id, empresaId, { entrada: entra })
        await bloquearProducto(t, producto.id)

        let costo: Dec
        if (entra) {
            const unitario = input.costo_unitario
                ? dec(input.costo_unitario)
                : await ultimoCosto(t, producto.id, bodega.id)
            if (unitario === null) {
                throw new ValidacionFallida([
                    {
                        field: 'costo_unitario',
                        message: `El producto ${producto.sku} no tiene costo conocido: indica costo_unitario`,
                        rule: 'costo_requerido',
                    },
                ])
            }
            costo = redondear(cantidad.times(unitario))
        } else {
            costo = costoSalida(
                await saldoDe(t, producto.id, bodega.id),
                cantidad.abs(),
                producto,
                bodega.id,
            ).neg()
        }
        const id = await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'ajuste',
                fecha: hoyGuatemala(),
                producto,
                bodegaId: bodega.id,
                cantidad,
                costoTotal: costo,
                motivo,
            },
            {
                contrapartida: entra ? CUENTAS_GT.SOBRANTES_INVENTARIO : CUENTAS_GT.MERMAS_INVENTARIO,
                descripcion: `Ajuste de inventario (${entra ? 'sobrante' : 'faltante'}) de ${producto.sku} en ${bodega.nombre}: ${motivo}`,
            },
        )
        t.fijarEntidad('movimiento_inventario', id)
        return verMovimiento(id, t.trx)
    }
}
