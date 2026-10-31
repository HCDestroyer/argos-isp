import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import {
    aCantidad,
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    exigirSeguimiento,
    insertarMovimiento,
    productoMovible,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'
import { actualizarUnidad, unidadesDeBodega } from '#inventario/unidades'
import {
    LOCK_NUMERO_TRASLADO,
    ORIGEN_ORDEN_TRASLADO,
    bodegaTransito,
    verOrdenTraslado,
    type OrdenTrasladoDetalle,
} from '#inventario/ordenes_traslado'

/**
 * `inventario.crear_traslado` (`POST /inventario/traslados/enviar`, fase D, `contratos/inventario.md`
 * D.1): envía varios productos de una bodega a otra (o a la de un técnico) con una orden de número
 * correlativo por empresa. Lo enviado sale del origen y entra a la bodega «en tránsito» de la empresa
 * (un par `traslado` por línea, `origen_tipo = orden_traslado`, sin asiento: misma cuenta 1.1.14); no
 * está disponible ni en el origen ni en el destino hasta que el destino lo recibe
 * (`inventario.recibir_traslado`) o el origen cancela (`inventario.cancelar_traslado`).
 *
 * - Por cantidad sale al costo promedio del origen (409 `existencia_insuficiente`); por serie, cada
 *   unidad a su costo y con `bodega_id` = tránsito (su estado no cambia: `disponible` o
 *   `en_reparacion`). Todo o nada.
 * - Un producto una sola vez por orden (422 `repetido`). Fecha de hoy. Emite
 *   `inventario.traslado_enviado` y un `inventario.movimiento_registrado` por movimiento.
 */

export interface LineaTrasladoEntrada {
    producto_id: number
    cantidad?: string | null
    unidad_ids?: number[] | null
}

export interface EntradaCrearTraslado {
    bodega_origen_id: number
    bodega_destino_id: number
    motivo?: string | null
    lineas: LineaTrasladoEntrada[]
}

/** Siguiente número de traslado de la empresa (con lock por empresa: sin huecos ni repetidos). */
async function siguienteNumero(t: Transaccion, empresaId: number): Promise<number> {
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_NUMERO_TRASLADO, empresaId])
    const fila = (await t.trx
        .from('inventario.ordenes_traslado')
        .where('empresa_id', empresaId)
        .max('numero as numero')
        .first()) as { numero: number | null }
    return Number(fila.numero ?? 0) + 1
}

/** Pide un `traslado_id` (un par de movimientos por línea y tramo). */
export async function nuevoTrasladoId(t: Transaccion): Promise<number> {
    const { rows } = (await t.trx.rawQuery(`SELECT nextval('inventario.traslados_seq')::bigint AS id`)) as {
        rows: Array<{ id: string }>
    }
    return Number(rows[0]!.id)
}

/**
 * Par de movimientos `traslado` de una orden (sin asiento): sale de `desde` y entra a `hacia` al mismo
 * costo; por serie, uno por unidad (y la unidad cambia de bodega).
 */
export async function moverDeOrden(
    t: Transaccion,
    datos: {
        empresaId: number
        ordenId: number
        producto: ProductoMovible
        desde: number
        hacia: number
        cantidad?: Dec
        costo?: Dec
        unidades?: Array<{ id: number; costo: Dec }>
        motivo?: string | null
    },
): Promise<void> {
    const trasladoId = await nuevoTrasladoId(t)
    const comun = {
        empresaId: datos.empresaId,
        tipo: 'traslado' as const,
        fecha: hoyGuatemala(),
        producto: datos.producto,
        trasladoId,
        origen: { tipo: ORIGEN_ORDEN_TRASLADO, id: datos.ordenId },
        motivo: datos.motivo ?? null,
        avisarMinimo: false,
    }
    if (datos.unidades) {
        for (const unidad of datos.unidades) {
            await insertarMovimiento(t, {
                ...comun,
                bodegaId: datos.desde,
                cantidad: dec('-1'),
                costoTotal: unidad.costo.neg(),
                unidadId: unidad.id,
            })
            await actualizarUnidad(t, unidad.id, { bodega_id: datos.hacia })
            await insertarMovimiento(t, {
                ...comun,
                bodegaId: datos.hacia,
                cantidad: dec('1'),
                costoTotal: unidad.costo,
                unidadId: unidad.id,
            })
        }
        return
    }
    await insertarMovimiento(t, {
        ...comun,
        bodegaId: datos.desde,
        cantidad: datos.cantidad!.neg(),
        costoTotal: datos.costo!.neg(),
    })
    await insertarMovimiento(t, {
        ...comun,
        bodegaId: datos.hacia,
        cantidad: datos.cantidad!,
        costoTotal: datos.costo!,
    })
}

export default class CrearTraslado extends DomainAction<EntradaCrearTraslado, OrdenTrasladoDetalle> {
    readonly nombre = 'inventario.crear_traslado'

    protected async handle(input: EntradaCrearTraslado, t: Transaccion): Promise<OrdenTrasladoDetalle> {
        if (input.bodega_origen_id === input.bodega_destino_id) {
            throw new ValidacionFallida([
                { field: 'bodega_destino_id', message: 'El destino es otra bodega', rule: 'distinta' },
            ])
        }
        if (input.lineas.length === 0) {
            throw new ValidacionFallida([
                { field: 'lineas', message: 'Indica al menos una línea', rule: 'required' },
            ])
        }
        const vistos = new Set<number>()
        const errores: ErrorCampo[] = []
        for (const [i, linea] of input.lineas.entries()) {
            if (vistos.has(linea.producto_id)) {
                errores.push({
                    field: `lineas.${i}.producto_id`,
                    message: 'El producto ya está en otra línea de la orden',
                    rule: 'repetido',
                })
            }
            vistos.add(linea.producto_id)
            const conUnidades = (linea.unidad_ids ?? []).length > 0
            if (conUnidades === Boolean(linea.cantidad)) {
                errores.push({
                    field: `lineas.${i}`,
                    message: 'Cada línea lleva cantidad (por cantidad) o unidad_ids (por serie)',
                    rule: 'cantidad_o_unidades',
                })
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // empresa: la del origen (una bodega de otra empresa como destino responde 404)
        const origenFila = (await t.trx
            .from('inventario.bodegas')
            .where('id', input.bodega_origen_id)
            .select('empresa_id')
            .first()) as { empresa_id: number } | null
        const empresaId = Number(origenFila?.empresa_id ?? 0)
        if (origenFila) exigirAccesoEmpresa(t.ctx, empresaId)
        const origen = await bodegaMovible(t, input.bodega_origen_id, empresaId, {
            campo: 'bodega_origen_id',
        })
        t.fijarEmpresa(empresaId)
        const destino = await bodegaMovible(t, input.bodega_destino_id, empresaId, {
            campo: 'bodega_destino_id',
            entrada: true,
        })
        const transitoId = await bodegaTransito(t, empresaId)
        const numero = await siguienteNumero(t, empresaId)
        const [orden] = (await t.trx
            .insertQuery()
            .table('inventario.ordenes_traslado')
            .insert({
                empresa_id: empresaId,
                numero,
                bodega_origen_id: origen.id,
                bodega_destino_id: destino.id,
                bodega_transito_id: transitoId,
                motivo: input.motivo?.trim() || null,
                enviado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const ordenId = Number(orden!.id)
        t.fijarEntidad('orden_traslado', ordenId)

        // locks de producto en orden de id (dos órdenes con los mismos productos no se cruzan)
        const productos = new Map<number, ProductoMovible>()
        for (const [i, linea] of input.lineas.entries()) {
            const producto = await productoMovible(t, linea.producto_id, {
                empresaId,
                campo: `lineas.${i}.producto_id`,
            })
            const ids = linea.unidad_ids ?? []
            exigirSeguimiento(
                producto,
                ids.length > 0,
                ids.length > 0 ? `lineas.${i}.unidad_ids` : `lineas.${i}.cantidad`,
            )
            productos.set(linea.producto_id, producto)
        }
        for (const id of [...productos.keys()].sort((a, b) => a - b)) await bloquearProducto(t, id)

        const eventoLineas: Array<{ producto_id: number; cantidad: string; unidad_ids: number[] }> = []
        for (const [i, linea] of input.lineas.entries()) {
            const producto = productos.get(linea.producto_id)!
            const ids = linea.unidad_ids ?? []
            if (ids.length > 0) {
                const unidades = await unidadesDeBodega(t, ids, {
                    empresaId,
                    productoId: producto.id,
                    bodegaId: origen.id,
                    campo: `lineas.${i}.unidad_ids`,
                })
                const costos = unidades.map((u) => ({ id: u.id, costo: dec(u.costo) }))
                const total = costos.reduce((s, u) => s.plus(u.costo), dec('0'))
                const [fila] = (await t.trx
                    .insertQuery()
                    .table('inventario.ordenes_traslado_lineas')
                    .insert({
                        orden_id: ordenId,
                        producto_id: producto.id,
                        cantidad: aCantidad(dec(String(ids.length))),
                        costo_total: aTexto(total),
                    })
                    .returning('id')) as Array<{ id: number }>
                await t.trx
                    .insertQuery()
                    .table('inventario.ordenes_traslado_unidades')
                    .multiInsert(
                        costos.map((u) => ({
                            linea_id: Number(fila!.id),
                            unidad_id: u.id,
                            costo: aTexto(u.costo),
                        })),
                    )
                await moverDeOrden(t, {
                    empresaId,
                    ordenId,
                    producto,
                    desde: origen.id,
                    hacia: transitoId,
                    unidades: costos,
                    motivo: input.motivo,
                })
                eventoLineas.push({
                    producto_id: producto.id,
                    cantidad: aCantidad(dec(String(ids.length))),
                    unidad_ids: ids,
                })
            } else {
                const cantidad = cantidadValida(linea.cantidad ?? '', `lineas.${i}.cantidad`)
                const costo = costoSalida(
                    await saldoDe(t, producto.id, origen.id),
                    cantidad,
                    producto,
                    origen.id,
                )
                await t.trx
                    .insertQuery()
                    .table('inventario.ordenes_traslado_lineas')
                    .insert({
                        orden_id: ordenId,
                        producto_id: producto.id,
                        cantidad: aCantidad(cantidad),
                        costo_total: aTexto(costo),
                    })
                await moverDeOrden(t, {
                    empresaId,
                    ordenId,
                    producto,
                    desde: origen.id,
                    hacia: transitoId,
                    cantidad,
                    costo,
                    motivo: input.motivo,
                })
                eventoLineas.push({ producto_id: producto.id, cantidad: aCantidad(cantidad), unidad_ids: [] })
            }
        }
        await t.emit('inventario.traslado_enviado', {
            orden_id: ordenId,
            empresa_id: empresaId,
            numero,
            bodega_origen_id: origen.id,
            bodega_destino_id: destino.id,
            usuario_destino_id: destino.tipo === 'tecnico' ? destino.usuario_id : null,
            lineas: eventoLineas,
        })
        return verOrdenTraslado(ordenId, t.trx)
    }
}
