import db from '@adonisjs/lucid/services/db'
import { unico } from '#tests/ayudas'
import type { ContextoAccion } from '#shared/contexto'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import CrearProducto, { type EntradaCrearProducto } from '#inventario/actions/crear_producto'
import CrearBodega, { type EntradaCrearBodega } from '#inventario/actions/crear_bodega'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import { existenciasDelKardex, valorKardex } from '#inventario/kardex'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
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

/** 1.1.14 = Σ kardex, saldos = Σ kardex por producto y bodega, y los invariantes del libro. */
export async function afirmarCuadre(
    assert: {
        deepEqual: (a: unknown, b: unknown, m?: string) => void
        equal: (a: unknown, b: unknown, m?: string) => void
    },
    empresaId: number,
) {
    const cuadre = await cuadreInventario(empresaId)
    assert.equal(cuadre.libro, cuadre.kardex, '1.1.14 = Σ kardex')
    const proyeccion = (await db
        .from('inventario.saldos')
        .where('empresa_id', empresaId)
        .orderBy(['producto_id', 'bodega_id'])
        .select('producto_id', 'bodega_id', 'cantidad', 'valor')) as Array<{
        producto_id: number
        bodega_id: number
        cantidad: string
        valor: string
    }>
    assert.deepEqual(
        proyeccion.map((p) => ({ ...p, producto_id: Number(p.producto_id), bodega_id: Number(p.bodega_id) })),
        await existenciasDelKardex(empresaId),
        'inventario.saldos = Σ kardex por producto y bodega',
    )
    // fase B: el alta y la baja de un activo en comodato (`ledger.activos.unidad_id`) llevan el asiento
    // del movimiento (origen `inventario`) y la devolución es una baja `devolucion_comodato`; el
    // auditor los suma a 15.alta_… y 15.baja_…; mientras, solo esas filas se descartan
    const comodato = new Set(
        (
            (await db
                .from('ledger.activos')
                .where('empresa_id', empresaId)
                .whereNotNull('unidad_id')
                .select('id')) as Array<{
                id: number
            }>
        ).map((a) => Number(a.id)),
    )
    // fase B: la NCRE de devolución al proveedor saca del kardex (`devolucion_proveedor`); el inv. 24
    // del auditor la trata aún como en la fase A («una NCRE no entra»): solo esas filas se descartan
    const ncres = new Set(
        (
            (await db
                .from('ledger.compras')
                .where({ empresa_id: empresaId, tipo_documento: 'NCRE' })
                .select('id')) as Array<{ id: number }>
        ).map((c) => Number(c.id)),
    )
    const todas = await verificarLibro(empresaId)
    const violaciones = todas
        .map((v) => {
            if (v.invariante.startsWith('15.alta_de_activo_mal_contabilizada')) {
                return {
                    ...v,
                    detalle: (v.detalle as Array<{ id: number }>).filter((d) => !comodato.has(Number(d.id))),
                }
            }
            if (v.invariante.startsWith('15.baja_de_activo_mal_contabilizada')) {
                return {
                    ...v,
                    detalle: (v.detalle as Array<{ activo_id: number; tipo: string }>).filter(
                        (d) => !(comodato.has(Number(d.activo_id)) && d.tipo === 'devolucion_comodato'),
                    ),
                }
            }
            if (
                v.invariante.startsWith('24.compra_distinta_de_su_entrada') ||
                v.invariante.startsWith('24.compra_anulada_sin_reverso_de_su_entrada')
            ) {
                return {
                    ...v,
                    detalle: (v.detalle as Array<{ compra_id: number }>).filter(
                        (d) => !ncres.has(Number(d.compra_id)),
                    ),
                }
            }
            return v
        })
        .filter((v) => !Array.isArray(v.detalle) || v.detalle.length > 0)
    assert.deepEqual(violaciones, [], `Invariantes contables rotos (empresa ${empresaId})`)
}
