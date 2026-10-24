import type { Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { dec, type Dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import {
    ExistenciaInsuficiente,
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    exigirSeguimiento,
    insertarMovimiento,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'
import { actualizarUnidad, unidadesDeBodega, type UnidadFila } from '#inventario/unidades'
import { CUENTA_COSTO_POR_DEFECTO } from '#inventario/productos'

/**
 * Venta del inventario (`contratos/inventario.md` §5, fase C): una línea de un cargo único con
 * `producto_id` y `bodega_id` (y `unidad_id` si es de serie) saca del kardex lo vendido.
 *
 * - **Venta** (`venta`): por cantidad, al costo promedio de la bodega; por serie, la unidad
 *   `disponible` a su costo (queda `vendida`, con el servicio del cargo). Asiento de costo de ventas
 *   `cuenta_costo` del producto (por defecto `5.6.01`) / `1.1.14`, origen `inventario`, diario de
 *   ventas (`VEN`: respeta el bloqueo de ventas), en la transacción de la factura. El ingreso y el
 *   IVA son los de la factura, como hoy.
 * - **Reverso** (`reverso_venta`): anular la factura o acreditar toda la línea con una nota de
 *   crédito (o la factura entera) reingresa lo que sigue vendido de esa línea al mismo costo, con el
 *   reverso del asiento de costo. La unidad vuelve `disponible` a su bodega.
 * - **Anular la nota** vuelve a sacar lo que ella reingresó (`venta`, al mismo costo): 409
 *   `existencia_insuficiente` o `unidad_no_disponible` si ya no está.
 */

export interface LineaVentaEntrada {
    producto_id?: number | null
    bodega_id?: number | null
    unidad_id?: number | null
    cantidad?: string | null
}

export interface VentaPreparada {
    indice: number
    producto: ProductoMovible
    bodegaId: number
    cantidad: Dec
    costo: Dec
    unidad: UnidadFila | null
}

/**
 * Valida y costea las líneas de inventario de un cargo único (con el lock de cada producto), antes de
 * emitir la factura. Devuelve una por línea con producto (en el orden de las líneas).
 */
export async function prepararVentas(
    t: Transaccion,
    empresaId: number,
    lineas: LineaVentaEntrada[],
): Promise<VentaPreparada[]> {
    const errores: ErrorCampo[] = []
    const con: Array<{ indice: number; linea: LineaVentaEntrada }> = []
    lineas.forEach((linea, indice) => {
        if (linea.producto_id || linea.bodega_id || linea.unidad_id) {
            if (!linea.producto_id || !linea.bodega_id) {
                errores.push({
                    field: `lineas.${indice}.${linea.producto_id ? 'bodega_id' : 'producto_id'}`,
                    message: 'Una línea que vende del inventario lleva producto_id y bodega_id',
                    rule: 'linea_inventario',
                })
                return
            }
            con.push({ indice, linea })
        }
    })
    if (errores.length > 0) throw new ValidacionFallida(errores)
    if (con.length === 0) return []
    const productos = new Map<number, ProductoMovible>()
    for (const { indice, linea } of con) {
        if (!productos.has(linea.producto_id!)) {
            productos.set(
                linea.producto_id!,
                await productoMovible(t, linea.producto_id!, { empresaId, campo: `lineas.${indice}.producto_id` }),
            )
        }
    }
    for (const id of [...productos.keys()].sort((a, b) => a - b)) await bloquearProducto(t, id)
    const salida: VentaPreparada[] = []
    // dos líneas del mismo producto y bodega: la segunda se costea después de la primera
    const usado = new Map<string, { cantidad: Dec; valor: Dec }>()
    for (const { indice, linea } of con) {
        const producto = productos.get(linea.producto_id!)!
        exigirSeguimiento(producto, Boolean(linea.unidad_id), `lineas.${indice}.unidad_id`)
        const bodega = await bodegaMovible(t, linea.bodega_id!, empresaId, { campo: `lineas.${indice}.bodega_id` })
        if (linea.unidad_id) {
            if (linea.cantidad && !dec(linea.cantidad).eq(1)) {
                throw new ValidacionFallida([
                    { field: `lineas.${indice}.cantidad`, message: 'Una unidad de serie se vende de una en una', rule: 'cantidad' },
                ])
            }
            const [unidad] = await unidadesDeBodega(t, [linea.unidad_id], {
                empresaId,
                productoId: producto.id,
                bodegaId: bodega.id,
                estados: ['disponible'],
                campo: `lineas.${indice}.unidad_id`,
            })
            if (salida.some((v) => v.unidad?.id === unidad!.id)) {
                throw new ValidacionFallida([
                    { field: `lineas.${indice}.unidad_id`, message: 'La unidad está en dos líneas', rule: 'distinta' },
                ])
            }
            salida.push({ indice, producto, bodegaId: bodega.id, cantidad: dec('1'), costo: dec(unidad!.costo), unidad: unidad! })
            continue
        }
        const cantidad = cantidadValida(linea.cantidad ?? '1', `lineas.${indice}.cantidad`)
        const clave = `${producto.id}:${bodega.id}`
        const saldo = await saldoDe(t, producto.id, bodega.id)
        const previo = usado.get(clave) ?? { cantidad: dec('0'), valor: dec('0') }
        const restante = { cantidad: saldo.cantidad.minus(previo.cantidad), valor: saldo.valor.minus(previo.valor) }
        const costo = costoSalida(restante, cantidad, producto, bodega.id)
        usado.set(clave, { cantidad: previo.cantidad.plus(cantidad), valor: previo.valor.plus(costo) })
        salida.push({ indice, producto, bodegaId: bodega.id, cantidad, costo, unidad: null })
    }
    return salida
}

/** Escribe la salida de cada venta preparada, ya emitida la factura. */
export async function registrarVentas(
    t: Transaccion,
    ventas: VentaPreparada[],
    factura: { id: number; empresa_id: number; fecha: string; servicio_id: number | null },
): Promise<void> {
    if (ventas.length === 0) return
    const lineas = (await t.trx
        .from('billing.facturas_lineas')
        .where('factura_id', factura.id)
        .whereNotNull('producto_id')
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    for (const [i, venta] of ventas.entries()) {
        const facturaLineaId = Number(lineas[i]!.id)
        if (venta.unidad) {
            await actualizarUnidad(t, venta.unidad.id, {
                estado: 'vendida',
                bodega_id: null,
                servicio_id: factura.servicio_id,
            })
        }
        await registrarMovimientoConAsiento(
            t,
            {
                empresaId: factura.empresa_id,
                tipo: 'venta',
                fecha: factura.fecha,
                producto: venta.producto,
                bodegaId: venta.bodegaId,
                cantidad: venta.cantidad.neg(),
                costoTotal: venta.costo.neg(),
                unidadId: venta.unidad?.id ?? null,
                servicioId: factura.servicio_id,
                facturaLineaId,
                origen: { tipo: 'factura', id: factura.id },
                motivo: `venta en la factura ${factura.id}`,
            },
            {
                contrapartida: venta.producto.cuenta_costo ?? CUENTA_COSTO_POR_DEFECTO,
                descripcion: `Costo de ventas de ${venta.producto.sku} · factura ${factura.id}`,
                diario: 'VEN',
            },
        )
    }
}

interface MovimientoVenta {
    id: number
    empresa_id: number
    tipo: string
    producto_id: number
    bodega_id: number
    cantidad: string
    costo_total: string
    unidad_id: number | null
    servicio_id: number | null
    asiento_id: number | null
    factura_linea_id: number
    origen_tipo: string
    origen_id: number
    reverso_de: number | null
}

/** Movimientos de venta (y reversos) de unas líneas de factura, en orden. */
async function movimientosDeLineas(t: Transaccion, lineaIds: number[]): Promise<MovimientoVenta[]> {
    if (lineaIds.length === 0) return []
    return (await t.trx
        .from('inventario.movimientos')
        .whereIn('factura_linea_id', lineaIds)
        .whereIn('tipo', ['venta', 'reverso_venta'])
        .orderBy('id')
        .select('*')) as MovimientoVenta[]
}

/**
 * Reingresa lo que sigue vendido de esas líneas (venta neta), al mismo costo, con el reverso del
 * asiento de costo. `origen`: la factura anulada o la nota de crédito.
 */
export async function revertirVentas(
    t: Transaccion,
    lineaIds: number[],
    origen: { tipo: 'factura' | 'nota_credito'; id: number },
    motivo: string,
): Promise<void> {
    const movimientos = await movimientosDeLineas(t, lineaIds)
    if (movimientos.length === 0) return
    for (const id of [...new Set(movimientos.map((m) => Number(m.producto_id)))].sort((a, b) => a - b)) {
        await bloquearProducto(t, id)
    }
    for (const lineaId of lineaIds) {
        const deLinea = movimientos.filter((m) => Number(m.factura_linea_id) === lineaId)
        const neto = deLinea.reduce((s, m) => s.plus(dec(m.cantidad)), dec('0'))
        if (!neto.lt(0)) continue
        // la última salida vigente de la línea (venta original o la que rehízo una nota anulada)
        const salida = [...deLinea].reverse().find((m) => m.tipo === 'venta')!
        const producto = await productoMovible(t, Number(salida.producto_id))
        let asientoId: number | null = null
        if (salida.asiento_id) {
            const reverso = await new RevertirAsiento().execute(
                { asiento_id: Number(salida.asiento_id), motivo, por_anulacion: true },
                t.ctx,
                { trx: t.trx },
            )
            asientoId = reverso.id
        }
        const fecha = (await t.trx
            .from('ledger.asientos')
            .where('id', asientoId ?? 0)
            .select(t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .first()) as { fecha: string } | null
        const unidadId = salida.unidad_id === null ? null : Number(salida.unidad_id)
        if (unidadId) {
            await actualizarUnidad(t, unidadId, { estado: 'disponible', bodega_id: Number(salida.bodega_id), servicio_id: null })
        }
        await insertarMovimiento(t, {
            empresaId: Number(salida.empresa_id),
            tipo: 'reverso_venta',
            fecha: fecha?.fecha ?? (await hoy(t)),
            producto,
            bodegaId: Number(salida.bodega_id),
            cantidad: dec(salida.cantidad).neg(),
            costoTotal: dec(salida.costo_total).neg(),
            unidadId,
            servicioId: salida.servicio_id === null ? null : Number(salida.servicio_id),
            facturaLineaId: lineaId,
            asientoId,
            origen,
            reversoDe: Number(salida.id),
            motivo,
        })
    }
}

async function hoy(t: Transaccion): Promise<string> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT to_char((now() AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') AS hoy`,
    )) as { rows: Array<{ hoy: string }> }
    return rows[0]!.hoy
}

/** Anular una nota de crédito: lo que ella reingresó vuelve a salir, al mismo costo. */
export async function rehacerVentasDeNota(t: Transaccion, notaId: number, motivo: string): Promise<void> {
    const reversos = (await t.trx
        .from('inventario.movimientos')
        .where({ tipo: 'reverso_venta', origen_tipo: 'nota_credito', origen_id: notaId })
        .orderBy('id')
        .select('*')) as MovimientoVenta[]
    if (reversos.length === 0) return
    for (const id of [...new Set(reversos.map((m) => Number(m.producto_id)))].sort((a, b) => a - b)) {
        await bloquearProducto(t, id)
    }
    for (const r of reversos) {
        const producto = await productoMovible(t, Number(r.producto_id))
        const cantidad = dec(r.cantidad)
        const costo = dec(r.costo_total)
        const bodegaId = Number(r.bodega_id)
        const unidadId = r.unidad_id === null ? null : Number(r.unidad_id)
        if (unidadId) {
            await unidadesDeBodega(t, [unidadId], {
                empresaId: Number(r.empresa_id),
                productoId: producto.id,
                bodegaId,
                estados: ['disponible'],
                campo: 'nota_credito',
            })
            await actualizarUnidad(t, unidadId, {
                estado: 'vendida',
                bodega_id: null,
                servicio_id: r.servicio_id === null ? null : Number(r.servicio_id),
            })
        } else {
            const saldo = await saldoDe(t, producto.id, bodegaId)
            if (cantidad.gt(saldo.cantidad)) throw new ExistenciaInsuficiente(producto, bodegaId, cantidad, saldo.cantidad)
            const queda = { cantidad: saldo.cantidad.minus(cantidad), valor: saldo.valor.minus(costo) }
            if (queda.valor.lt(0) || (queda.cantidad.isZero() && !queda.valor.isZero())) {
                throw new Conflicto(
                    `Anular la nota ${notaId} volvería a sacar ${cantidad.toFixed(3)} de ${producto.sku} a Q${costo.toFixed(2)} y dejaría la bodega ${bodegaId} con Q${queda.valor.toFixed(2)}: corrige antes con un ajuste`,
                    'valor_insuficiente',
                    'Valor de inventario insuficiente',
                )
            }
        }
        const original = (await t.trx
            .from('ledger.movimientos as m')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .join('inventario.movimientos as v', 'v.asiento_id', 'm.asiento_id')
            .where('v.id', Number(r.reverso_de))
            .whereNot('c.codigo', CUENTAS_GT.INVENTARIOS)
            .select('c.codigo')
            .first()) as { codigo: string } | null
        await registrarMovimientoConAsiento(
            t,
            {
                empresaId: Number(r.empresa_id),
                tipo: 'venta',
                fecha: await hoy(t),
                producto,
                bodegaId,
                cantidad: cantidad.neg(),
                costoTotal: costo.neg(),
                unidadId,
                servicioId: r.servicio_id === null ? null : Number(r.servicio_id),
                facturaLineaId: Number(r.factura_linea_id),
                origen: { tipo: 'nota_credito', id: notaId },
                reversoDe: Number(r.id),
                motivo,
            },
            {
                contrapartida: original?.codigo ?? producto.cuenta_costo ?? CUENTA_COSTO_POR_DEFECTO,
                descripcion: `Costo de ventas de ${producto.sku} otra vez: anulación de la nota ${notaId}`,
                diario: 'VEN',
            },
        )
    }
}

/** Líneas de una factura que venden del inventario y lo que lleva acreditado cada una. */
export async function lineasDeVenta(t: Transaccion, facturaId: number) {
    return (await t.trx
        .from('billing.facturas_lineas as l')
        .where('l.factura_id', facturaId)
        .whereNotNull('l.producto_id')
        .select(
            'l.id',
            'l.total',
            'l.descuento',
            t.trx.raw(
                `(select coalesce(sum(nl.monto), 0) from billing.notas_credito_lineas nl where nl.linea_id = l.id
                    and not exists (select 1 from billing.notas_credito_anulaciones x where x.nota_id = nl.nota_id))::text as acreditado`,
            ),
        )) as Array<{ id: number; total: string; descuento: string | null; acreditado: string }>
}

/**
 * Después de una nota de crédito: reingresa las líneas de inventario que quedaron acreditadas por
 * completo (por línea, o la factura entera con notas por monto).
 */
export async function revertirVentasPorNota(
    t: Transaccion,
    nota: { id: number; factura_id: number; motivo: string },
): Promise<void> {
    const lineas = await lineasDeVenta(t, nota.factura_id)
    if (lineas.length === 0) return
    const factura = (await t.trx
        .from('billing.facturas as f')
        .where('f.id', nota.factura_id)
        .select(
            'f.total',
            t.trx.raw(
                `(select coalesce(sum(n.monto), 0) from billing.notas_credito n where n.factura_id = f.id
                    and not exists (select 1 from billing.notas_credito_anulaciones x where x.nota_id = n.id))::text as notas`,
            ),
        )
        .first()) as { total: string; notas: string }
    const todaLaFactura = dec(factura.notas).gte(dec(factura.total))
    const completas = lineas
        .filter((l) => {
            const neto = dec(l.total).minus(dec(l.descuento ?? '0').abs())
            return todaLaFactura || dec(l.acreditado).gte(neto)
        })
        .map((l) => Number(l.id))
    await revertirVentas(t, completas, { tipo: 'nota_credito', id: nota.id }, `nota de crédito ${nota.id}: ${nota.motivo}`)
}

/** Al anular la factura: todo lo que sigue vendido de sus líneas. */
export async function revertirVentasDeFactura(t: Transaccion, facturaId: number, motivo: string): Promise<void> {
    const lineas = await lineasDeVenta(t, facturaId)
    await revertirVentas(
        t,
        lineas.map((l) => Number(l.id)),
        { tipo: 'factura', id: facturaId },
        `anulación de la factura ${facturaId}: ${motivo}`,
    )
}
