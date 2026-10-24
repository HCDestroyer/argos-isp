import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

type Movimiento = Schema<'MovimientoInventario'>

/** Cantidad con 3 decimales y monto con 2, como la API. */
export const cantidad3 = (valor: Decimal.Value): string => new Decimal(valor).toFixed(3)
export const monto2 = (valor: Decimal.Value): string => new Decimal(valor).toFixed(2)

/** Saldo de un producto en una bodega: la suma de su kardex (`inventario.saldos` de A3). */
export function saldoDe(movimientos: readonly Movimiento[], productoId: number, bodegaId: number): { cantidad: Decimal, valor: Decimal } {
    return movimientos
        .filter(m => m.producto_id === productoId && m.bodega_id === bodegaId)
        .reduce((total, m) => ({ cantidad: total.cantidad.plus(m.cantidad), valor: total.valor.plus(m.costo_total) }), { cantidad: new Decimal(0), valor: new Decimal(0) })
}

/**
 * Valor de una salida al promedio de la bodega (`costoSalida` de A3): `cantidad × valor /
 * existencia` a centavos; la que vacía la bodega lleva todo lo que queda. `null` si no alcanza.
 */
export function costoSalida(movimientos: readonly Movimiento[], productoId: number, bodegaId: number, cantidad: Decimal): Decimal | null {
    const saldo = saldoDe(movimientos, productoId, bodegaId)
    if (cantidad.greaterThan(saldo.cantidad)) {
        return null
    }
    return cantidad.equals(saldo.cantidad) ? saldo.valor : saldo.valor.times(cantidad).dividedBy(saldo.cantidad).toDecimalPlaces(2)
}

export type NuevoMovimiento = Pick<Movimiento, 'tipo' | 'fecha' | 'producto_id' | 'bodega_id'> & Partial<Omit<Movimiento, 'cantidad' | 'costo_total'>> & { cantidad: Decimal.Value, costo_total: Decimal.Value }

/**
 * Agrega un movimiento al kardex con su saldo corrido (por producto y bodega) y los nombres que
 * trae la vista de la API. Solo inserción, como `inventario.movimientos`.
 */
export function agregarMovimiento(
    movimientos: Movimiento[],
    nombres: { producto: Pick<Schema<'Producto'>, 'sku' | 'nombre' | 'empresa_id'>, bodega: string },
    nuevo: NuevoMovimiento,
    creado: string,
): Movimiento {
    const saldo = saldoDe(movimientos, nuevo.producto_id, nuevo.bodega_id)
    const cantidad = new Decimal(nuevo.cantidad)
    const costoTotal = new Decimal(nuevo.costo_total)
    const movimiento: Movimiento = {
        id: Math.max(0, ...movimientos.map(m => m.id)) + 1,
        empresa_id: nombres.producto.empresa_id,
        tipo: nuevo.tipo,
        fecha: nuevo.fecha,
        producto_id: nuevo.producto_id,
        producto_sku: nombres.producto.sku,
        producto_nombre: nombres.producto.nombre,
        bodega_id: nuevo.bodega_id,
        bodega_nombre: nombres.bodega,
        cantidad: cantidad3(cantidad),
        costo_unitario: cantidad.isZero() ? '0.000000' : costoTotal.dividedBy(cantidad).abs().toFixed(6),
        costo_total: monto2(costoTotal),
        unidad_id: nuevo.unidad_id ?? null,
        servicio_id: nuevo.servicio_id ?? null,
        asiento_id: nuevo.asiento_id ?? (nuevo.tipo === 'traslado' ? null : 7000 + movimientos.length + 1),
        origen_tipo: nuevo.origen_tipo ?? null,
        origen_id: nuevo.origen_id ?? null,
        traslado_id: nuevo.traslado_id ?? null,
        reverso_de: nuevo.reverso_de ?? null,
        causa: nuevo.causa ?? null,
        motivo: nuevo.motivo ?? null,
        actor_tipo: nuevo.actor_tipo ?? 'usuario',
        actor_id: nuevo.actor_id ?? 1,
        created_at: creado,
        saldo_cantidad: cantidad3(saldo.cantidad.plus(cantidad)),
        saldo_valor: monto2(saldo.valor.plus(costoTotal)),
    }
    movimientos.push(movimiento)
    return movimiento
}
