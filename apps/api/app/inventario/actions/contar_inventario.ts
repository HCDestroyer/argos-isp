import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { dec } from '#ledger/dinero'
import {
    aCantidad,
    bloquearProducto,
    cantidadValida,
    productoMovible,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'
import { EN_BODEGA, normalizarMac, normalizarSerie } from '#inventario/unidades'
import { aTexto } from '#ledger/dinero'
import { verConteo, type ConteoVista } from '#inventario/conteos'

/**
 * `inventario.contar` (`POST /inventario/conteos/:id/lineas`): captura lo contado de un producto en
 * un conteo abierto (§5). Una línea por producto: capturarla otra vez la reemplaza.
 *
 * - Por cantidad: `contado` ≥ 0 con hasta 3 decimales; sin `series`.
 * - Por serie: `series` (serie o MAC de cada unidad encontrada, sin repetir); `contado` es cuántas.
 * - `costo_unitario` (opcional, > 0): costo de un sobrante si la bodega no tiene existencia del
 *   producto (con existencia, el sobrante entra a su promedio, como en un ajuste).
 *
 * Guarda lo esperado **al capturar** (H56): cantidad y valor de la bodega, por serie sus unidades, y el
 * último movimiento; capturar otra vez lo vuelve a tomar. Conteo cerrado o cancelado: 409
 * `conteo_no_abierto`.
 */

export interface EntradaContar {
    conteo_id: number
    producto_id: number
    contado?: string | null
    series?: string[] | null
    costo_unitario?: string | null
}

/** Conteo abierto, bloqueado (FOR UPDATE); 404 si no existe, 409 si no está abierto. */
export async function conteoAbierto(
    t: Transaccion,
    id: number,
): Promise<{ id: number; empresa_id: number; bodega_id: number; version: number }> {
    const fila = (await t.trx.from('inventario.conteos').where('id', id).forUpdate().first()) as {
        id: number
        empresa_id: number
        bodega_id: number
        estado: string
        version: number
    } | null
    if (!fila) throw new NoEncontrado(`El conteo ${id} no existe`)
    exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
    t.fijarEmpresa(Number(fila.empresa_id))
    t.fijarEntidad('conteo_inventario', id)
    if (fila.estado !== 'abierto') {
        throw new Conflicto(`El conteo ${id} está ${fila.estado}`, 'conteo_no_abierto', 'Conteo no abierto')
    }
    return {
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        bodega_id: Number(fila.bodega_id),
        version: Number(fila.version),
    }
}

/**
 * Lo que la bodega tiene de un producto ahora (H56): cantidad y valor del saldo, las unidades en la
 * bodega (serie) y el último movimiento del producto allí.
 */
export async function fotoDeLaBodega(
    t: Transaccion,
    producto: ProductoMovible,
    bodegaId: number,
): Promise<{
    cantidad: string
    valor: string
    unidades: number[] | null
    ultimoMovimientoId: number | null
}> {
    const saldo = await saldoDe(t, producto.id, bodegaId)
    const unidades =
        producto.seguimiento === 'serie'
            ? (
                  (await t.trx
                      .from('inventario.unidades')
                      .where({ producto_id: producto.id, bodega_id: bodegaId })
                      .whereIn('estado', EN_BODEGA as string[])
                      .orderBy('id')
                      .select('id')) as Array<{ id: number }>
              ).map((u) => Number(u.id))
            : null
    const ultimo = (await t.trx
        .from('inventario.movimientos')
        .where({ producto_id: producto.id, bodega_id: bodegaId })
        .max('id as id')
        .first()) as { id: number | null } | null
    return {
        cantidad: aCantidad(saldo.cantidad),
        valor: aTexto(saldo.valor),
        unidades,
        ultimoMovimientoId: ultimo?.id ? Number(ultimo.id) : null,
    }
}

export default class ContarInventario extends DomainAction<EntradaContar, ConteoVista> {
    readonly nombre = 'inventario.contar'

    protected async handle(input: EntradaContar, t: Transaccion): Promise<ConteoVista> {
        const conteo = await conteoAbierto(t, input.conteo_id)
        const producto = await productoMovible(t, input.producto_id, { empresaId: conteo.empresa_id })
        const series = input.series ?? null
        let contado: string
        let guardadas: string[] = []
        if (producto.seguimiento === 'serie') {
            if (!series) {
                throw new ValidacionFallida([
                    {
                        field: 'series',
                        message: `El producto ${producto.sku} se lleva por serie: indica las series o MAC contadas`,
                        rule: 'requiere_unidades',
                    },
                ])
            }
            const vistas = new Set<string>()
            for (const [i, valor] of series.entries()) {
                const limpio = valor.trim()
                const clave = normalizarMac(limpio) ?? normalizarSerie(limpio)
                if (!clave) {
                    throw new ValidacionFallida([
                        { field: `series.${i}`, message: 'Serie o MAC vacía', rule: 'required' },
                    ])
                }
                if (vistas.has(clave)) {
                    throw new ValidacionFallida([
                        { field: `series.${i}`, message: `${limpio} está repetida`, rule: 'serie_duplicada' },
                    ])
                }
                vistas.add(clave)
                guardadas.push(limpio)
            }
            contado = aCantidad(dec(String(guardadas.length)))
        } else {
            if (series && series.length > 0) {
                throw new ValidacionFallida([
                    {
                        field: 'series',
                        message: `El producto ${producto.sku} se lleva por cantidad: no lleva series`,
                        rule: 'no_aplica',
                    },
                ])
            }
            const valor = input.contado ?? ''
            contado = dec(String(valor)).isZero() ? '0.000' : aCantidad(cantidadValida(valor, 'contado'))
            guardadas = []
        }
        let costoUnitario: string | null = null
        if (
            input.costo_unitario !== undefined &&
            input.costo_unitario !== null &&
            input.costo_unitario !== ''
        ) {
            const unitario = dec(input.costo_unitario)
            if (unitario.lte(0)) {
                throw new ValidacionFallida([
                    {
                        field: 'costo_unitario',
                        message: 'El costo unitario de un sobrante es mayor que 0',
                        rule: 'costo_requerido',
                    },
                ])
            }
            costoUnitario = unitario.toFixed(6)
        }
        // H56: lo esperado al capturar (con el lock del producto, una foto coherente con el kardex)
        await bloquearProducto(t, producto.id)
        const captura = await fotoDeLaBodega(t, producto, conteo.bodega_id)
        const datos = {
            esperado_captura: captura.cantidad,
            valor_captura: captura.valor,
            unidades_captura: captura.unidades === null ? null : JSON.stringify(captura.unidades),
            ultimo_movimiento_id: captura.ultimoMovimientoId,
            capturado_en: t.trx.knexRawQuery('now()'),
            contado,
            series: JSON.stringify(guardadas),
            costo_unitario: costoUnitario,
            registrado_por: usuarioDelActor(t.ctx.actor),
        }
        const linea = await t.trx
            .from('inventario.conteo_lineas')
            .where({ conteo_id: conteo.id, producto_id: producto.id })
            .select('id')
            .first()
        if (linea) {
            await t.trx
                .from('inventario.conteo_lineas')
                .where('id', linea.id)
                .update({ ...datos, updated_at: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
        } else {
            await t.trx
                .insertQuery()
                .table('inventario.conteo_lineas')
                .insert({ conteo_id: conteo.id, producto_id: producto.id, ...datos })
        }
        await t.trx
            .from('inventario.conteos')
            .where('id', conteo.id)
            .update({
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        return verConteo(conteo.id, t.trx)
    }
}
