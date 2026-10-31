import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { dec, redondear } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTA_CONSUMO_POR_DEFECTO } from '#inventario/productos'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    exigirExistenciaDesde,
    exigirPromedioSinCambiosDesde,
    fechaDeOperacion,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'
import { unidadParaComodato } from '#inventario/comodato'
import type { OrigenExterno, OrigenExternoTipo } from '#inventario/origen_externo'
import {
    bodegaDelTecnico,
    empresaDelTecnico,
    resolverTecnico,
    type TecnicoExterno,
} from '#inventario/tecnicos'
import type { Modalidad } from '#inventario/tipos_producto'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'

/**
 * Consumo a un servicio según la modalidad de cada producto (fase D, `contratos/inventario.md` D.3 y
 * D.6; contrato Iris 0.5.0 §3.3). Lo usa `inventario.consumir` (`POST /inventario/consumos`, una
 * línea o `lineas[]`, todo o nada):
 *
 * - `consumible_gasto`: el consumo de siempre (`cuenta_consumo` / 1.1.14), con fecha pasada opcional.
 * - `consumible_cobro`: un **cargo único inmediato** al cliente del servicio por
 *   `facturas.emitir_cargo_unico` (una factura por petición, una línea por producto cobrado): venta del
 *   kardex con `5.6.01 / 1.1.14` al costo y la factura `CxC / ingreso + IVA`. Precio: el de la línea o el
 *   `precio_venta` del producto; concepto: el de la línea o el `concepto_cargo_id` del producto.
 * - `comodato`: 422 `producto_es_comodato` (contrato Iris 0.5.0 §3.3): los equipos van por
 *   `POST /servicios/:id/equipos`. Un cobro sin servicio: 422 `cobro_sin_cliente`.
 *
 * La bodega: `bodega_id` o, con `tecnico` (orden de Iris), la del técnico. Todo o nada.
 */

export interface LineaConsumo {
    producto_id?: number | null
    cantidad?: string | null
    unidad_id?: number | null
    serie?: string | null
    precio_unitario?: string | null
    concepto_id?: number | null
}

export interface DatosConsumo {
    bodega_id?: number | null
    tecnico?: TecnicoExterno | null
    servicio_id?: number | null
    motivo?: string | null
    fecha?: string | null
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}

export interface CargoConsumo {
    /** la factura del cargo único */
    id: number
    producto_id: number
    /** precio × cantidad, IVA incluido */
    monto: string
}

export interface ResultadoConsumos {
    empresaId: number
    /** un movimiento por línea, en el orden de las líneas */
    movimientos: number[]
    facturaId: number | null
    cargos: CargoConsumo[]
}

function problema(status: number, codigo: string, titulo: string, campo: string, message: string): Problema {
    return new Problema(status, codigo, titulo, message, [{ field: campo, message, rule: codigo }])
}

function error(campo: string, message: string, rule: string): ValidacionFallida {
    return new ValidacionFallida([{ field: campo, message, rule }])
}

/** Bodega del consumo: la indicada o la del técnico de la orden; 422 `bodega_id` sin ninguna. */
async function bodegaDelConsumo(t: Transaccion, datos: DatosConsumo, empresaId: number): Promise<number> {
    if (datos.bodega_id) return datos.bodega_id
    if (datos.tecnico) return bodegaDelTecnico(t.trx, await resolverTecnico(t, datos.tecnico), empresaId)
    throw error('bodega_id', 'Indica la bodega (o el técnico de la orden)', 'required')
}

/** Empresa del consumo: la del servicio, o la de la bodega o el primer producto. */
async function empresaDelConsumo(
    t: Transaccion,
    datos: DatosConsumo,
    lineas: LineaConsumo[],
): Promise<number> {
    if (datos.servicio_id) {
        const servicio = await t.trx
            .from('core.servicios')
            .where('id', datos.servicio_id)
            .select('empresa_id')
            .first()
        if (!servicio) throw new NoEncontrado(`El servicio ${datos.servicio_id} no existe`)
        return Number(servicio.empresa_id)
    }
    if (datos.bodega_id) {
        const bodega = await t.trx
            .from('inventario.bodegas')
            .where('id', datos.bodega_id)
            .select('empresa_id')
            .first()
        if (!bodega) throw new NoEncontrado(`La bodega ${datos.bodega_id} no existe`)
        return Number(bodega.empresa_id)
    }
    if (datos.tecnico) {
        const usuarioId = await resolverTecnico(t, datos.tecnico)
        return empresaDelTecnico(t.trx, usuarioId, t.ctx.empresaId, t.ctx.empresasPermitidas ?? null)
    }
    if (t.ctx.empresaId) return t.ctx.empresaId
    const primero = lineas.find((l) => l.producto_id)
    if (primero) {
        const producto = await productoMovible(t, primero.producto_id!)
        return producto.empresa_id
    }
    throw error('bodega_id', 'Indica la bodega (o el técnico de la orden)', 'required')
}

export async function aplicarConsumos(
    t: Transaccion,
    datos: DatosConsumo,
    lineas: LineaConsumo[],
    origenExterno: OrigenExterno | null,
    campoLinea: (i: number, campo: string) => string,
): Promise<ResultadoConsumos> {
    if (lineas.length === 0) throw error('lineas', 'Indica al menos una línea', 'required')
    const empresaId = await empresaDelConsumo(t, datos, lineas)
    t.fijarEmpresa(empresaId)
    if (datos.servicio_id) {
        const servicio = await t.trx
            .from('core.servicios')
            .where({ id: datos.servicio_id, empresa_id: empresaId })
            .select('id')
            .first()
        if (!servicio) throw new NoEncontrado(`El servicio ${datos.servicio_id} no existe en esta empresa`)
    }
    const bodegaId = await bodegaDelConsumo(t, datos, empresaId)
    const bodega = await bodegaMovible(t, bodegaId, empresaId)

    // 1. cada línea: producto, modalidad y lo que necesita (422 por línea, todas a la vez)
    interface Plan {
        i: number
        producto: ProductoMovible & {
            modalidad: Modalidad
            precio_venta: string | null
            concepto_cargo_id: number | null
        }
        unidadId: number | null
        cantidad: string
        precio: string | null
        concepto: number | null
    }
    const planes: Plan[] = []
    const errores: ErrorCampo[] = []
    for (const [i, l] of lineas.entries()) {
        const conUnidad = Boolean(l.unidad_id) || Boolean(l.serie?.trim())
        let unidadId: number | null = null
        if (conUnidad) {
            if (!datos.servicio_id) {
                throw problema(
                    422,
                    'cobro_sin_cliente',
                    'Cobro sin cliente',
                    'servicio_id',
                    'Un equipo por serie solo se consume cobrándolo al cliente de un servicio: indica servicio_id',
                )
            }
            unidadId = await unidadParaComodato(
                datos.servicio_id,
                { unidad_id: l.unidad_id, serie: l.serie },
                t.trx,
            )
        }
        let productoId = l.producto_id ?? null
        if (!productoId && unidadId) {
            const fila = await t.trx
                .from('inventario.unidades')
                .where('id', unidadId)
                .select('producto_id')
                .first()
            productoId = fila ? Number(fila.producto_id) : null
        }
        if (!productoId) {
            errores.push({
                field: campoLinea(i, 'producto_id'),
                message: 'Indica el producto',
                rule: 'required',
            })
            continue
        }
        const base = await productoMovible(t, productoId, { empresaId, campo: campoLinea(i, 'producto_id') })
        const extra = (await t.trx
            .from('inventario.productos')
            .where('id', base.id)
            .select('modalidad', t.trx.raw('precio_venta::text as precio_venta'), 'concepto_cargo_id')
            .first()) as {
            modalidad: Modalidad
            precio_venta: string | null
            concepto_cargo_id: number | null
        }
        const producto = {
            ...base,
            ...extra,
            concepto_cargo_id: extra.concepto_cargo_id === null ? null : Number(extra.concepto_cargo_id),
        }
        // contrato Iris 0.5.0 §3.3: los equipos en comodato van por POST /servicios/:id/equipos
        if (producto.modalidad === 'comodato') {
            throw problema(
                422,
                'producto_es_comodato',
                'Producto en comodato',
                campoLinea(i, 'producto_id'),
                `El producto ${base.sku} se presta en comodato: va por POST /servicios/:id/equipos`,
            )
        }
        if (base.seguimiento === 'serie' && !unidadId) {
            errores.push({
                field: campoLinea(i, 'unidad_id'),
                message: `El producto ${base.sku} se lleva por serie: indica unidad_id o serie`,
                rule: 'requiere_unidades',
            })
            continue
        }
        if (base.seguimiento !== 'serie' && unidadId) {
            errores.push({
                field: campoLinea(i, 'unidad_id'),
                message: `El producto ${base.sku} se lleva por cantidad: no lleva unidades`,
                rule: 'no_aplica',
            })
            continue
        }
        if (producto.modalidad === 'consumible_cobro' && !datos.servicio_id) {
            throw problema(
                422,
                'cobro_sin_cliente',
                'Cobro sin cliente',
                'servicio_id',
                `El producto ${base.sku} se cobra al cliente: indica el servicio`,
            )
        }
        let precio: string | null = null
        let concepto: number | null = null
        if (producto.modalidad === 'consumible_cobro') {
            precio = l.precio_unitario ?? producto.precio_venta
            if (!precio || !dec(precio).gt(0)) {
                errores.push({
                    field: campoLinea(i, 'precio_unitario'),
                    message: `El producto ${base.sku} se cobra: indica precio_unitario o dale precio_venta`,
                    rule: 'precio_requerido',
                })
            }
            concepto = l.concepto_id ?? producto.concepto_cargo_id
            if (!concepto) {
                errores.push({
                    field: campoLinea(i, 'concepto_id'),
                    message: `El producto ${base.sku} se cobra: indica concepto_id o dale concepto_cargo_id`,
                    rule: 'concepto_requerido',
                })
            }
        } else {
            for (const campo of ['precio_unitario', 'concepto_id'] as const) {
                if (l[campo] !== undefined && l[campo] !== null) {
                    errores.push({
                        field: campoLinea(i, campo),
                        message: `El producto ${base.sku} no se cobra (${producto.modalidad.replaceAll('_', ' ')})`,
                        rule: 'no_aplica',
                    })
                }
            }
        }
        let cantidad = '1'
        if (!unidadId) {
            try {
                cantidad = cantidadValida(l.cantidad ?? '', campoLinea(i, 'cantidad')).toString()
            } catch (e) {
                if (e instanceof ValidacionFallida) errores.push(...(e.errores ?? []))
                continue
            }
        }
        planes.push({ i, producto, unidadId, cantidad, precio, concepto })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    const hayVenta = planes.some((p) => p.producto.modalidad === 'consumible_cobro')
    if (hayVenta && datos.fecha && datos.fecha !== hoyGuatemala()) {
        throw error('fecha', 'Un cobro va con la fecha de hoy', 'no_aplica')
    }

    // 2. los gastos (con el lock de su producto, en orden de id)
    const movimientos = new Map<number, number>()
    const gastos = planes.filter((p) => p.producto.modalidad === 'consumible_gasto')
    if (gastos.length > 0) {
        const fecha = await fechaDeOperacion(t, empresaId, datos.fecha)
        for (const id of [...new Set(gastos.map((p) => p.producto.id))].sort((a, b) => a - b)) {
            await bloquearProducto(t, id)
        }
        for (const p of gastos) {
            const cantidad = dec(p.cantidad)
            const costo = costoSalida(
                await saldoDe(t, p.producto.id, bodega.id),
                cantidad,
                p.producto,
                bodega.id,
            )
            await exigirPromedioSinCambiosDesde(t, p.producto, bodega.id, fecha)
            await exigirExistenciaDesde(t, p.producto, bodega.id, fecha, cantidad, costo)
            const id = await registrarMovimientoConAsiento(
                t,
                {
                    empresaId,
                    tipo: 'consumo',
                    fecha,
                    producto: p.producto,
                    bodegaId: bodega.id,
                    cantidad: cantidad.neg(),
                    costoTotal: costo.neg(),
                    servicioId: datos.servicio_id ?? null,
                    motivo: datos.motivo ?? null,
                    origenExterno,
                },
                {
                    contrapartida: p.producto.cuenta_consumo ?? CUENTA_CONSUMO_POR_DEFECTO,
                    descripcion: `Consumo de ${p.producto.sku} · ${p.producto.nombre} (${bodega.nombre})${datos.servicio_id ? ` · servicio ${datos.servicio_id}` : ''}`,
                },
            )
            movimientos.set(p.i, id)
        }
    }

    // 4. los cobros: un cargo único con una línea por producto (venta del kardex con su costo)
    let facturaId: number | null = null
    const cobros = planes.filter((p) => p.producto.modalidad === 'consumible_cobro')
    if (cobros.length > 0) {
        const cargo = await new EmitirCargoUnico().execute(
            {
                servicio_id: datos.servicio_id!,
                origen_tipo: datos.origen_tipo ?? null,
                origen_id: datos.origen_id ?? null,
                por_modalidad: true,
                lineas: cobros.map((p) => ({
                    concepto_id: p.concepto!,
                    descripcion: `${p.producto.nombre} (${p.producto.sku})`,
                    cantidad: p.cantidad,
                    precio_unitario: dec(p.precio!).toFixed(2),
                    producto_id: p.producto.id,
                    bodega_id: bodega.id,
                    unidad_id: p.unidadId,
                })),
            },
            t.ctx,
            { trx: t.trx },
        )
        facturaId = cargo.documento === 'factura' ? Number(cargo.id) : null
        const ventas = (await t.trx
            .from('inventario.movimientos as m')
            .join('billing.facturas_lineas as l', 'l.id', 'm.factura_linea_id')
            .where('l.factura_id', facturaId ?? 0)
            .where('m.tipo', 'venta')
            .orderBy('m.id')
            .select('m.id', 'm.producto_id')) as Array<{ id: number; producto_id: number }>
        // una venta por línea del cargo, en el mismo orden
        for (const [k, p] of cobros.entries()) {
            const venta = ventas[k]
            if (venta) movimientos.set(p.i, Number(venta.id))
        }
    }
    return {
        empresaId,
        movimientos: planes.map((p) => movimientos.get(p.i)!).filter((id) => id !== undefined),
        facturaId,
        cargos: facturaId
            ? cobros.map((p) => ({
                  id: facturaId!,
                  producto_id: p.producto.id,
                  monto: redondear(dec(p.precio!).times(dec(p.cantidad))).toFixed(2),
              }))
            : [],
    }
}
