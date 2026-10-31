import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { dec } from '#ledger/dinero'
import { verMovimiento, type MovimientoVista } from '#inventario/kardex'
import type { ProductoVista } from '#inventario/productos'
import { problemaModalidad } from '#inventario/tipos_producto'
import { normalizarMac, normalizarSerie, type UnidadNueva } from '#inventario/unidades'
import CrearProducto, { type EntradaCrearProducto } from '#inventario/actions/crear_producto'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'

/**
 * `productos.crear_lote` (`POST /productos/lote`, fase D, `contratos/inventario.md` D.4): N productos en
 * una sola transacción, todo o nada, con `Idempotency-Key` obligatoria (la ruta).
 *
 * 1. Primero valida todo lo que se puede sin escribir (SKU repetido en el lote o en la empresa, tipo,
 *    modalidad, bodega y series de la entrada) y responde 422 con **todos** los `errors[]` como
 *    `productos.<i>.campo`.
 * 2. Después crea cada producto con `productos.crear` y, si trae `entrada`, su **saldo inicial** con
 *    `inventario.cargar_saldo_inicial` (`1.1.14 / 2.9.01`; por serie, una por unidad): el producto es
 *    nuevo y no tiene movimientos, que es el caso del saldo inicial. Un error ahí deshace todo y sale
 *    con su campo prefijado (`productos.<i>.…`) o con `productos.<i>` en el detalle.
 *
 * La entrada exige además `inventario.cargar_saldo_inicial` (la ruta).
 */

export interface EntradaInicialLote {
    bodega_id: number
    cantidad?: string | null
    costo_unitario?: string | null
    costo_total?: string | null
    unidades?: Array<UnidadNueva & { costo: string }> | null
    fecha?: string | null
}

export type ProductoLote = Omit<EntradaCrearProducto, 'empresa_id'> & { entrada?: EntradaInicialLote | null }

export interface EntradaCrearProductosLote {
    empresa_id?: number | null
    productos: ProductoLote[]
}

export interface ResultadoLote {
    data: ProductoVista[]
    movimientos: MovimientoVista[]
}

/** Vuelve a lanzar un error de una fila con su campo dentro de `productos.<i>`. */
function conFila(error: unknown, i: number): unknown {
    if (!(error instanceof Problema)) return error
    const codigo = error.tipo.split(':').pop() ?? 'error'
    const errores = error.errores?.map((e) => ({ ...e, field: `productos.${i}.${e.field}` }))
    return new Problema(
        error.status,
        codigo,
        error.titulo,
        `productos.${i}: ${error.detalle ?? error.titulo}`,
        errores ?? [{ field: `productos.${i}`, message: error.detalle ?? error.titulo, rule: codigo }],
    )
}

export default class CrearProductosLote extends DomainAction<EntradaCrearProductosLote, ResultadoLote> {
    readonly nombre = 'productos.crear_lote'

    protected async handle(input: EntradaCrearProductosLote, t: Transaccion): Promise<ResultadoLote> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (input.productos.length === 0) {
            throw new ValidacionFallida([
                { field: 'productos', message: 'Indica al menos un producto', rule: 'required' },
            ])
        }

        // 1. validación de todas las filas, sin escribir
        const errores: ErrorCampo[] = []
        const skus = new Map<string, number>()
        const series = new Map<string, string>()
        const tipos = (await t.trx
            .from('inventario.tipos_producto')
            .where((q) => q.where('empresa_id', empresaId).orWhereNull('empresa_id'))
            .orderByRaw('empresa_id IS NULL')
            .select('codigo', 'seguimiento_defecto', 'modalidad_defecto', 'activo')) as Array<{
            codigo: string
            seguimiento_defecto: 'cantidad' | 'serie'
            modalidad_defecto: string
            activo: boolean
        }>
        const existentes = new Set(
            (
                (await t.trx
                    .from('inventario.productos')
                    .where('empresa_id', empresaId)
                    .whereIn(
                        t.trx.raw('upper(sku)'),
                        input.productos.map((p) => p.sku.trim().toUpperCase()),
                    )
                    .select('sku')) as Array<{ sku: string }>
            ).map((f) => f.sku.toUpperCase()),
        )
        const bodegas = new Map(
            (
                (await t.trx
                    .from('inventario.bodegas')
                    .where('empresa_id', empresaId)
                    .whereIn(
                        'id',
                        input.productos.flatMap((p) => (p.entrada ? [p.entrada.bodega_id] : [])),
                    )
                    .select('id', 'tipo', 'activo')) as Array<{ id: number; tipo: string; activo: boolean }>
            ).map((b) => [Number(b.id), b]),
        )
        for (const [i, p] of input.productos.entries()) {
            const campo = (c: string) => `productos.${i}.${c}`
            const sku = p.sku.trim().toUpperCase()
            if (skus.has(sku)) {
                errores.push({
                    field: campo('sku'),
                    message: `El SKU ${p.sku} se repite en la fila ${skus.get(sku)}`,
                    rule: 'sku_duplicado',
                })
            } else if (existentes.has(sku)) {
                errores.push({
                    field: campo('sku'),
                    message: `La empresa ya tiene el SKU ${p.sku}`,
                    rule: 'sku_duplicado',
                })
            }
            skus.set(sku, i)
            const tipo = tipos.find((x) => x.codigo === p.tipo.trim().toLowerCase())
            if (!tipo) {
                errores.push({
                    field: campo('tipo'),
                    message: `El tipo de producto ${p.tipo} no existe`,
                    rule: 'tipo',
                })
                continue
            }
            if (!tipo.activo) {
                errores.push({
                    field: campo('tipo'),
                    message: `El tipo ${p.tipo} está desactivado`,
                    rule: 'tipo_inactivo',
                })
            }
            const seguimiento = p.seguimiento ?? tipo.seguimiento_defecto
            if (p.modalidad) {
                const problema = problemaModalidad(p.modalidad, seguimiento, campo('modalidad'))
                if (problema) errores.push(problema)
            }
            const e = p.entrada
            if (!e) continue
            const bodega = bodegas.get(e.bodega_id)
            if (!bodega) {
                errores.push({
                    field: campo('entrada.bodega_id'),
                    message: `La bodega ${e.bodega_id} no existe en la empresa`,
                    rule: 'exists',
                })
            } else if (bodega.tipo === 'transito' || !bodega.activo) {
                errores.push({
                    field: campo('entrada.bodega_id'),
                    message: `La bodega ${e.bodega_id} no recibe entradas`,
                    rule: 'bodega_inactiva',
                })
            }
            if (seguimiento === 'serie') {
                if (!e.unidades || e.unidades.length === 0) {
                    errores.push({
                        field: campo('entrada.unidades'),
                        message: 'Un producto de serie entra con sus unidades',
                        rule: 'requiere_unidades',
                    })
                }
                if (e.cantidad || e.costo_unitario || e.costo_total) {
                    errores.push({
                        field: campo('entrada.cantidad'),
                        message: 'Por serie, cada unidad lleva su costo',
                        rule: 'no_aplica',
                    })
                }
                for (const [k, u] of (e.unidades ?? []).entries()) {
                    const claves = [normalizarSerie(u.serie), u.mac ? normalizarMac(u.mac) : null].filter(
                        Boolean,
                    ) as string[]
                    if (claves.length === 0) {
                        errores.push({
                            field: campo(`entrada.unidades.${k}`),
                            message: 'Cada unidad lleva serie o MAC válida',
                            rule: 'required',
                        })
                    }
                    for (const clave of claves) {
                        if (series.has(clave)) {
                            errores.push({
                                field: campo(`entrada.unidades.${k}`),
                                message: `${clave} se repite en ${series.get(clave)}`,
                                rule: 'serie_duplicada',
                            })
                        }
                        series.set(clave, campo(`entrada.unidades.${k}`))
                    }
                    if (!dec(u.costo).gt(0)) {
                        errores.push({
                            field: campo(`entrada.unidades.${k}.costo`),
                            message: 'El costo es mayor que 0',
                            rule: 'costo',
                        })
                    }
                }
            } else {
                if (e.unidades && e.unidades.length > 0) {
                    errores.push({
                        field: campo('entrada.unidades'),
                        message: 'Un producto por cantidad no lleva unidades',
                        rule: 'no_aplica',
                    })
                }
                if (!e.cantidad || !dec(e.cantidad).gt(0)) {
                    errores.push({
                        field: campo('entrada.cantidad'),
                        message: 'Indica la cantidad',
                        rule: 'required',
                    })
                }
                if (Boolean(e.costo_unitario) === Boolean(e.costo_total)) {
                    errores.push({
                        field: campo('entrada.costo_unitario'),
                        message: 'Indica costo_unitario o costo_total (uno)',
                        rule: 'costo',
                    })
                }
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // 2. crear, en la misma transacción (un error deshace todo)
        const data: ProductoVista[] = []
        const movimientos: MovimientoVista[] = []
        for (const [i, p] of input.productos.entries()) {
            try {
                const { entrada, ...datos } = p
                const producto = await new CrearProducto().execute(
                    { ...datos, empresa_id: empresaId },
                    t.ctx,
                    {
                        trx: t.trx,
                    },
                )
                data.push(producto)
                if (!entrada) continue
                const saldos =
                    producto.seguimiento === 'serie'
                        ? (entrada.unidades ?? []).map((u) => ({
                              unidad: { serie: u.serie ?? null, mac: u.mac ?? null },
                              costo_total: dec(u.costo).toFixed(2),
                          }))
                        : [
                              {
                                  cantidad: entrada.cantidad,
                                  costo_unitario: entrada.costo_unitario ?? null,
                                  costo_total: entrada.costo_total ?? null,
                              },
                          ]
                for (const saldo of saldos) {
                    const movimiento = await new CargarSaldoInicial().execute(
                        {
                            producto_id: producto.id,
                            bodega_id: entrada.bodega_id,
                            fecha: entrada.fecha ?? null,
                            motivo: 'Alta por lote',
                            ...saldo,
                        },
                        t.ctx,
                        { trx: t.trx },
                    )
                    movimientos.push(movimiento)
                }
            } catch (error) {
                throw conFila(error, i)
            }
        }
        if (data[0]) t.fijarEntidad('producto', data[0].id)
        t.anotarAuditoria({ productos: data.map((p) => p.id), movimientos: movimientos.map((m) => m.id) })
        for (const [k, m] of movimientos.entries()) movimientos[k] = await verMovimiento(m.id, t.trx)
        return { data, movimientos }
    }
}
