import type { Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import type { CompraPreparada } from '#ledger/preparar_compra'
import {
    ExistenciaInsuficiente,
    bloquearProducto,
    bodegaMovible,
    insertarMovimiento,
    productoMovible,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'

/**
 * Ganchos del inventario en las compras (`contratos/inventario.md` §5, fase A).
 *
 * - **Entrada.** Cada línea `bien` con `producto_id` y `bodega_id` va en el asiento de la compra a
 *   `1.1.14 Inventarios` (lo resuelve `resolverCuentasLineas`) y entra al kardex por `cantidad` al
 *   costo de la línea: base, más el IVA si la compra no tiene crédito fiscal. El movimiento
 *   (`entrada_compra`) lleva el asiento de la compra, su fecha contable y origen `compra`.
 * - **Reverso.** Anular la compra saca lo que entró al mismo costo (`reverso_compra`, con el asiento
 *   de reverso). 409 `existencia_insuficiente` si ya no está en su bodega, y 409
 *   `valor_insuficiente` si la salida dejaría la bodega con valor negativo o con valor sin
 *   existencia (el costo de la compra ya salió en consumos o traslados al promedio).
 *
 * Sin líneas de inventario, nada de esto corre: la compra es la de siempre.
 */

export interface EntradasCompra {
    /** escribe los movimientos del kardex, después del asiento de la compra */
    despuesDelAsiento: (asiento: { id: number; fecha: string }, compraId: number) => Promise<void>
}

export async function entradasDeLaCompra(t: Transaccion, compra: CompraPreparada): Promise<EntradasCompra> {
    const errores: ErrorCampo[] = []
    const lineas: Array<{ producto: ProductoMovible; bodegaId: number; i: number }> = []
    for (const [i, linea] of compra.lineas.entries()) {
        if (!linea.producto_id || !linea.bodega_id) continue
        try {
            const producto = await productoMovible(t, linea.producto_id, {
                empresaId: compra.empresaId,
                campo: `lineas.${i}.producto_id`,
                entrada: true,
            })
            const bodega = await bodegaMovible(t, linea.bodega_id, compra.empresaId, {
                campo: `lineas.${i}.bodega_id`,
                entrada: true,
            })
            lineas.push({ producto, bodegaId: bodega.id, i })
        } catch (error) {
            if (error instanceof ValidacionFallida && error.errores) {
                errores.push(...error.errores)
                continue
            }
            throw error
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return {
        despuesDelAsiento: async (asiento, compraId) => {
            for (const { producto, bodegaId, i } of lineas) {
                const linea = compra.lineas[i]!
                await bloquearProducto(t, producto.id)
                await insertarMovimiento(t, {
                    empresaId: compra.empresaId,
                    tipo: 'entrada_compra',
                    fecha: asiento.fecha,
                    producto,
                    bodegaId,
                    cantidad: dec(String(linea.cantidad)),
                    costoTotal: compra.credito ? linea.base : linea.total,
                    asientoId: asiento.id,
                    origen: { tipo: 'compra', id: compraId },
                    motivo: linea.descripcion,
                })
            }
        },
    }
}

/** Saca del kardex lo que entró con la compra, al mismo costo, con el asiento de reverso. */
export async function revertirEntradasDeLaCompra(
    t: Transaccion,
    compraId: number,
    reverso: { id: number; fecha: string },
): Promise<void> {
    const entradas = (await t.trx
        .from('inventario.movimientos')
        .where({ origen_tipo: 'compra', origen_id: compraId, tipo: 'entrada_compra' })
        .orderBy('id')
        .select('id', 'empresa_id', 'producto_id', 'bodega_id', 'cantidad', 'costo_total')) as Array<{
        id: number
        empresa_id: number
        producto_id: number
        bodega_id: number
        cantidad: string
        costo_total: string
    }>
    if (entradas.length === 0) return
    // locks en orden de producto: dos anulaciones simultáneas no se cruzan
    for (const productoId of [...new Set(entradas.map((e) => Number(e.producto_id)))].sort((a, b) => a - b)) {
        await bloquearProducto(t, productoId)
    }
    for (const entrada of entradas) {
        const producto = await productoMovible(t, Number(entrada.producto_id))
        const bodegaId = Number(entrada.bodega_id)
        const cantidad = dec(entrada.cantidad)
        const costo = dec(entrada.costo_total)
        const saldo = await saldoDe(t, producto.id, bodegaId)
        if (cantidad.gt(saldo.cantidad)) {
            throw new ExistenciaInsuficiente(producto, bodegaId, cantidad, saldo.cantidad)
        }
        const queda = { cantidad: saldo.cantidad.minus(cantidad), valor: saldo.valor.minus(costo) }
        if (queda.valor.lt(0) || (queda.cantidad.isZero() && !queda.valor.isZero())) {
            throw new Conflicto(
                `Anular la compra ${compraId} dejaría ${producto.sku} en la bodega ${bodegaId} con ${queda.cantidad.toFixed(3)} y Q${aTexto(queda.valor)}: parte de su costo ya salió al promedio`,
                'valor_insuficiente',
                'Valor de inventario insuficiente',
            )
        }
        await insertarMovimiento(t, {
            empresaId: Number(entrada.empresa_id),
            tipo: 'reverso_compra',
            fecha: reverso.fecha,
            producto,
            bodegaId,
            cantidad: cantidad.neg(),
            costoTotal: costo.neg(),
            asientoId: reverso.id,
            origen: { tipo: 'compra', id: compraId },
            reversoDe: Number(entrada.id),
            motivo: `anulación de la compra ${compraId}`,
        })
    }
}
