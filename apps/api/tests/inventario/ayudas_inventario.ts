import db from '@adonisjs/lucid/services/db'
import { unico } from '#tests/ayudas'
import type { ContextoAccion } from '#shared/contexto'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import CrearProducto, { type EntradaCrearProducto } from '#inventario/actions/crear_producto'
import CrearBodega, { type EntradaCrearBodega } from '#inventario/actions/crear_bodega'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import { valorKardex } from '#inventario/kardex'
import { dec } from '#ledger/dinero'

/**
 * Ayudas de las pruebas del inventario (fase A).
 */

export async function productoEn(
    empresaId: number,
    ctx: ContextoAccion,
    extra: Partial<EntradaCrearProducto> = {},
) {
    return new CrearProducto().execute(
        {
            empresa_id: empresaId,
            sku: unico('SKU'),
            nombre: 'Cable UTP cat 6',
            unidad: 'metro',
            tipo: 'material',
            seguimiento: 'cantidad',
            ...extra,
        },
        ctx,
    )
}

export async function bodegaEn(
    empresaId: number,
    ctx: ContextoAccion,
    extra: Partial<EntradaCrearBodega> = {},
) {
    return new CrearBodega().execute(
        { empresa_id: empresaId, nombre: unico('Bodega'), tipo: 'bodega', ...extra },
        ctx,
    )
}

/** Compra al crédito (FACT con crédito fiscal) de `cantidad` unidades por `total` con IVA. */
export async function comprarInventario(
    empresaId: number,
    ctx: ContextoAccion,
    datos: { producto_id: number; bodega_id: number; cantidad: number; total: string; proveedorId?: number },
) {
    let proveedorId = datos.proveedorId
    if (!proveedorId) {
        const proveedor = await proveedorEn(empresaId, ctx)
        proveedorId = proveedor.id
    }
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedorId,
            tipo_documento: 'FACT',
            numero: unico('F'),
            fecha_documento: haceMeses(0),
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'Compra de inventario',
                    tipo: 'bien',
                    total: datos.total,
                    cantidad: datos.cantidad,
                    producto_id: datos.producto_id,
                    bodega_id: datos.bodega_id,
                },
            ],
        },
        ctx,
    )
}

/** Saldo de 1.1.14 en el libro y valor del kardex de la empresa (deben ser iguales). */
export async function cuadreInventario(empresaId: number) {
    const libro = await saldoCuenta(empresaId, CUENTAS_GT.INVENTARIOS)
    const kardex = await valorKardex(empresaId)
    return { libro: dec(libro).toFixed(2), kardex: kardex.toFixed(2) }
}

/** Saldo proyectado de un producto en una bodega: [cantidad, valor]. */
export async function saldoInventario(productoId: number, bodegaId: number) {
    const fila = await db
        .from('inventario.saldos')
        .where({ producto_id: productoId, bodega_id: bodegaId })
        .select('cantidad', 'valor')
        .first()
    return fila ? [fila.cantidad as string, fila.valor as string] : ['0.000', '0.00']
}

export async function contarMovimientos(empresaId: number) {
    const kardex = await db
        .from('inventario.movimientos')
        .where('empresa_id', empresaId)
        .count('* as n')
        .first()
    const asientos = await db
        .from('ledger.asientos')
        .where({ empresa_id: empresaId, origen_tipo: 'inventario' })
        .count('* as n')
        .first()
    return { kardex: Number(kardex.n), asientos: Number(asientos.n) }
}
