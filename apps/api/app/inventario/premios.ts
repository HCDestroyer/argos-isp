import type { Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoSalida,
    exigirSeguimiento,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
} from '#inventario/kardex'
import { actualizarUnidad, unidadesDeBodega } from '#inventario/unidades'

/**
 * Salida «premio» del kardex (`contratos/inventario.md` §5, decisión del líder, fase C): la única forma
 * de que un premio en especie salga del inventario.
 *
 * - **Salida** (`premio`): por cantidad al promedio de la bodega; por serie, la unidad `disponible` a su
 *   costo, que queda `entregada`. Asiento propio `5.1.03 Premios y promociones / 1.1.14` al costo
 *   (origen `inventario` = el movimiento); sin costo (Q0), sin asiento. El movimiento cita el documento
 *   que lo pide (`origen`: el ganador del sorteo).
 * - **Reverso** (`reverso_premio`): anular la entrega reingresa lo entregado al mismo costo y a la misma
 *   bodega con `1.1.14 / 5.1.03`; la unidad vuelve `disponible`.
 *
 * El ISR del premio y su valor declarado no son del kardex: los lleva el documento del premio.
 */

export interface SalidaPremio {
    empresaId: number
    productoId: number
    bodegaId: number
    /** producto de serie: la unidad */
    unidadId?: number | null
    /** producto por cantidad (1 por defecto) */
    cantidad?: string | null
    origen: { tipo: string; id: number }
    descripcion: string
    /** nombres de los campos de la petición (para los errores) */
    campos?: { producto?: string; bodega?: string; unidad?: string; cantidad?: string }
}

export async function salidaPorPremio(
    t: Transaccion,
    datos: SalidaPremio,
): Promise<{ movimientoId: number; costo: Dec }> {
    const campos = {
        producto: 'producto_id',
        bodega: 'bodega_id',
        unidad: 'unidad_id',
        cantidad: 'cantidad',
        ...datos.campos,
    }
    const producto = await productoMovible(t, datos.productoId, {
        empresaId: datos.empresaId,
        campo: campos.producto,
    })
    exigirSeguimiento(producto, Boolean(datos.unidadId), datos.unidadId ? campos.unidad : campos.cantidad)
    const bodega = await bodegaMovible(t, datos.bodegaId, datos.empresaId, { campo: campos.bodega })
    await bloquearProducto(t, producto.id)
    let cantidad: Dec
    let costo: Dec
    let unidadId: number | null = null
    if (datos.unidadId) {
        const [unidad] = await unidadesDeBodega(t, [datos.unidadId], {
            empresaId: datos.empresaId,
            productoId: producto.id,
            bodegaId: bodega.id,
            estados: ['disponible'],
            campo: campos.unidad,
        })
        cantidad = dec('-1')
        costo = dec(unidad!.costo).neg()
        unidadId = unidad!.id
        await actualizarUnidad(t, unidadId, { estado: 'entregada', bodega_id: null })
    } else {
        const pedida = cantidadValida(datos.cantidad ?? '1', campos.cantidad)
        cantidad = pedida.neg()
        costo = costoSalida(await saldoDe(t, producto.id, bodega.id), pedida, producto, bodega.id).neg()
    }
    const movimientoId = await registrarMovimientoConAsiento(
        t,
        {
            empresaId: datos.empresaId,
            tipo: 'premio',
            fecha: hoyGuatemala(),
            producto,
            bodegaId: bodega.id,
            cantidad,
            costoTotal: costo,
            unidadId,
            origen: datos.origen,
            motivo: datos.descripcion,
        },
        {
            contrapartida: CUENTAS_GT.PREMIOS_PROMOCIONES,
            descripcion: `Premio en especie: ${producto.sku} de ${bodega.nombre} · ${datos.descripcion}`,
        },
    )
    return { movimientoId, costo: costo.abs() }
}

/** Reingresa una salida `premio` (anulación de la entrega) al mismo costo y bodega. */
export async function revertirPremio(
    t: Transaccion,
    movimientoId: number,
    origen: { tipo: string; id: number },
    motivo: string,
): Promise<number> {
    const salida = (await t.trx.from('inventario.movimientos').where('id', movimientoId).first()) as {
        id: number
        empresa_id: number
        tipo: string
        producto_id: number
        bodega_id: number
        cantidad: string
        costo_total: string
        unidad_id: number | null
    } | null
    if (!salida || salida.tipo !== 'premio') {
        throw new NoEncontrado(`El movimiento ${movimientoId} no es un premio`)
    }
    const producto = await productoMovible(t, Number(salida.producto_id))
    await bloquearProducto(t, producto.id)
    const previo = await t.trx
        .from('inventario.movimientos')
        .where({ reverso_de: salida.id, tipo: 'reverso_premio' })
        .select('id')
        .first()
    if (previo) {
        throw new Conflicto(`El premio ${salida.id} ya se reingresó`, 'premio_revertido', 'Premio revertido')
    }
    const unidadId = salida.unidad_id === null ? null : Number(salida.unidad_id)
    if (unidadId !== null) {
        await t.trx.from('inventario.unidades').where('id', unidadId).forUpdate().select('id')
        await actualizarUnidad(t, unidadId, { estado: 'disponible', bodega_id: Number(salida.bodega_id) })
    }
    return registrarMovimientoConAsiento(
        t,
        {
            empresaId: Number(salida.empresa_id),
            tipo: 'reverso_premio',
            fecha: hoyGuatemala(),
            producto,
            bodegaId: Number(salida.bodega_id),
            cantidad: dec(salida.cantidad).neg(),
            costoTotal: dec(salida.costo_total).neg(),
            unidadId,
            origen,
            reversoDe: Number(salida.id),
            motivo,
        },
        {
            contrapartida: CUENTAS_GT.PREMIOS_PROMOCIONES,
            descripcion: `Reverso del premio en especie (movimiento ${salida.id}): ${motivo}`,
        },
    )
}
