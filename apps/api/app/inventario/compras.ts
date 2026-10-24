import type { Transaccion } from '#shared/domain_action'
import { Conflicto, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import type { CompraPreparada } from '#ledger/preparar_compra'
import type { LineaCompraCalculada } from '#ledger/compras'
import {
    ExistenciaInsuficiente,
    bloquearProducto,
    bodegaMovible,
    exigirSeguimiento,
    insertarMovimiento,
    productoMovible,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'
import {
    actualizarUnidad,
    crearUnidades,
    repartirCosto,
    unidadesDeBodega,
    validarUnidadesNuevas,
    type UnidadFila,
    type UnidadNormalizada,
} from '#inventario/unidades'

/**
 * Ganchos del inventario en las compras (`contratos/inventario.md` §5).
 *
 * - **Entrada.** Cada línea `bien` con `producto_id` y `bodega_id` va en el asiento de la compra a
 *   `1.1.14 Inventarios` (lo resuelve `resolverCuentasLineas`) y entra al kardex por `cantidad` al
 *   costo de la línea: base, más el IVA si la compra no tiene crédito fiscal. Un producto de serie
 *   lleva `unidades[]` (una serie o MAC por unidad; 422 `serie_duplicada`) y el costo se reparte
 *   entre ellas (el residuo de centavos en la última); entra un movimiento por unidad.
 * - **Devolución al proveedor** (fase B). Una NCRE con líneas de producto saca del kardex lo que se
 *   devuelve, al costo de la compra que corrige (`devolucion_proveedor`, con el asiento de la NCRE):
 *   por cantidad, al costo promedio de lo que entró con esa compra en esa bodega (lo último que queda
 *   por devolver lleva su costo exacto); por serie, `unidad_ids` de esa compra, disponibles en la
 *   bodega, a su costo (quedan `devuelta_proveedor`). La línea de la NCRE debe valer ese costo (422
 *   `devolucion_distinta_del_costo`) y no pasar de lo que entró (422 `devolucion_excede_compra`).
 * - **Reverso.** Anular la compra (o la NCRE) revierte sus movimientos al mismo costo con el asiento
 *   de reverso (`reverso_compra`). 409 `unidades_en_uso` si una unidad que entró ya no está tal como
 *   entró: disponible en su bodega, a su costo de compra y sin más movimientos que traslados (H42); 409 `existencia_insuficiente` y `valor_insuficiente` como en la fase A.
 *
 * Sin líneas de inventario, nada de esto corre: la compra es la de siempre.
 */

export interface EntradasCompra {
    /** escribe unidades y movimientos del kardex, después del asiento de la compra */
    despuesDelAsiento: (asiento: { id: number; fecha: string }, compraId: number) => Promise<void>
}

interface LineaInventario {
    i: number
    linea: LineaCompraCalculada
    producto: ProductoMovible
    bodegaId: number
    costo: Dec
    cantidad: Dec
    /** entrada de serie: unidades nuevas validadas */
    nuevas: UnidadNormalizada[]
    /** devolución de serie: unidades que salen */
    salen: UnidadFila[]
}

const problemaLinea = (i: number, campo: string, mensaje: string, regla: string): ValidacionFallida =>
    new ValidacionFallida([{ field: `lineas.${i}.${campo}`, message: mensaje, rule: regla }])

export async function entradasDeLaCompra(t: Transaccion, compra: CompraPreparada): Promise<EntradasCompra> {
    const devolucion = compra.tipo === 'NCRE'
    const errores: ErrorCampo[] = []
    const lineas: LineaInventario[] = []
    for (const [i, linea] of compra.lineas.entries()) {
        if (!linea.producto_id || !linea.bodega_id) {
            if (linea.unidades.length > 0 || linea.unidad_ids.length > 0) {
                errores.push({
                    field: `lineas.${i}.unidades`,
                    message: 'Las unidades van en una línea con producto_id',
                    rule: 'no_aplica',
                })
            }
            continue
        }
        try {
            const producto = await productoMovible(t, linea.producto_id, {
                empresaId: compra.empresaId,
                campo: `lineas.${i}.producto_id`,
                entrada: !devolucion,
            })
            const bodega = await bodegaMovible(t, linea.bodega_id, compra.empresaId, {
                campo: `lineas.${i}.bodega_id`,
                entrada: !devolucion,
            })
            const serie = producto.seguimiento === 'serie'
            const conUnidades = devolucion ? linea.unidad_ids.length > 0 : linea.unidades.length > 0
            exigirSeguimiento(producto, conUnidades, `lineas.${i}.${devolucion ? 'unidad_ids' : 'unidades'}`)
            if (devolucion ? linea.unidades.length > 0 : linea.unidad_ids.length > 0) {
                throw problemaLinea(
                    i,
                    devolucion ? 'unidades' : 'unidad_ids',
                    devolucion
                        ? 'Una NCRE devuelve unidades existentes (unidad_ids)'
                        : 'Una compra trae unidades nuevas (unidades)',
                    'no_aplica',
                )
            }
            const unidades = devolucion ? linea.unidad_ids.length : linea.unidades.length
            if (serie && unidades !== linea.cantidad) {
                throw problemaLinea(
                    i,
                    'cantidad',
                    `La cantidad (${linea.cantidad}) es el número de unidades (${unidades})`,
                    'cantidad',
                )
            }
            lineas.push({
                i,
                linea,
                producto,
                bodegaId: bodega.id,
                costo: compra.credito ? linea.base : linea.total,
                cantidad: dec(String(linea.cantidad)),
                nuevas: [],
                salen: [],
            })
        } catch (error) {
            if (error instanceof ValidacionFallida && error.errores) {
                errores.push(...error.errores)
                continue
            }
            throw error
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    if (lineas.length === 0) return { despuesDelAsiento: async () => {} }

    // locks en orden de producto (como el reverso): dos compras simultáneas no se cruzan
    for (const productoId of [...new Set(lineas.map((l) => l.producto.id))].sort((a, b) => a - b)) {
        await bloquearProducto(t, productoId)
    }
    for (const l of lineas) {
        if (devolucion) {
            await validarDevolucion(t, compra, l)
        } else if (l.producto.seguimiento === 'serie') {
            l.nuevas = await validarUnidadesNuevas(
                t,
                compra.empresaId,
                l.linea.unidades,
                `lineas.${l.i}.unidades`,
            )
        }
    }

    return {
        despuesDelAsiento: async (asiento, compraId) => {
            for (const l of lineas) {
                const comun = {
                    empresaId: compra.empresaId,
                    fecha: asiento.fecha,
                    producto: l.producto,
                    bodegaId: l.bodegaId,
                    asientoId: asiento.id,
                    origen: { tipo: 'compra', id: compraId },
                    motivo: l.linea.descripcion,
                }
                if (devolucion) {
                    if (l.salen.length > 0) {
                        for (const unidad of l.salen) {
                            await actualizarUnidad(t, unidad.id, {
                                estado: 'devuelta_proveedor',
                                bodega_id: null,
                            })
                            await insertarMovimiento(t, {
                                ...comun,
                                tipo: 'devolucion_proveedor',
                                cantidad: dec('-1'),
                                costoTotal: dec(unidad.costo).neg(),
                                unidadId: unidad.id,
                            })
                        }
                    } else {
                        await insertarMovimiento(t, {
                            ...comun,
                            tipo: 'devolucion_proveedor',
                            cantidad: l.cantidad.neg(),
                            costoTotal: l.costo.neg(),
                        })
                    }
                } else if (l.nuevas.length > 0) {
                    const costos = repartirCosto(l.costo, l.nuevas.length)
                    const unidades = await crearUnidades(t, {
                        empresaId: compra.empresaId,
                        productoId: l.producto.id,
                        bodegaId: l.bodegaId,
                        unidades: l.nuevas,
                        costos,
                        compraId,
                    })
                    for (const unidad of unidades) {
                        await insertarMovimiento(t, {
                            ...comun,
                            tipo: 'entrada_compra',
                            cantidad: dec('1'),
                            costoTotal: dec(unidad.costo),
                            unidadId: unidad.id,
                        })
                    }
                } else {
                    await insertarMovimiento(t, {
                        ...comun,
                        tipo: 'entrada_compra',
                        cantidad: l.cantidad,
                        costoTotal: l.costo,
                    })
                }
            }
        },
    }
}

/**
 * Devolución al proveedor: lo que sale (y a qué costo) de lo que entró con la compra que la NCRE
 * corrige, en esa bodega. Deja en `l.salen` las unidades de serie.
 */
async function validarDevolucion(t: Transaccion, compra: CompraPreparada, l: LineaInventario): Promise<void> {
    const referencia = compra.referenciaId!
    let costo: Dec
    if (l.producto.seguimiento === 'serie') {
        l.salen = await unidadesDeBodega(t, l.linea.unidad_ids, {
            empresaId: compra.empresaId,
            productoId: l.producto.id,
            bodegaId: l.bodegaId,
            estados: ['disponible', 'en_reparacion'],
            campo: `lineas.${l.i}.unidad_ids`,
        })
        const ajena = l.salen.find((u) => u.compra_id !== referencia)
        if (ajena) {
            throw problemaLinea(
                l.i,
                'unidad_ids',
                `La unidad ${ajena.serie ?? ajena.mac} no entró con la compra ${referencia}`,
                'unidad_de_otra_compra',
            )
        }
        costo = l.salen.reduce((s, u) => s.plus(dec(u.costo)), dec('0'))
    } else {
        const fila = (await t.trx
            .from('inventario.movimientos as m')
            .where({ 'm.producto_id': l.producto.id, 'm.bodega_id': l.bodegaId })
            .where((q) =>
                q
                    .where((e) => e.where('m.tipo', 'entrada_compra').where('m.origen_id', referencia))
                    .orWhere((d) =>
                        d
                            .where('m.tipo', 'devolucion_proveedor')
                            .whereIn(
                                'm.origen_id',
                                t.trx
                                    .from('ledger.compras')
                                    .where('compra_referencia_id', referencia)
                                    .select('id'),
                            ),
                    ),
            )
            .where('m.origen_tipo', 'compra')
            .whereNotExists((q) => q.from('inventario.movimientos as r').whereRaw('r.reverso_de = m.id'))
            .select(
                t.trx.raw(
                    `coalesce(sum(m.cantidad) FILTER (WHERE m.tipo = 'entrada_compra'), 0)::text as entro`,
                ),
                t.trx.raw(
                    `coalesce(sum(m.costo_total) FILTER (WHERE m.tipo = 'entrada_compra'), 0)::text as costo_entro`,
                ),
                t.trx.raw(`coalesce(sum(m.cantidad), 0)::text as queda`),
                t.trx.raw(`coalesce(sum(m.costo_total), 0)::text as costo_queda`),
            )
            .first()) as { entro: string; costo_entro: string; queda: string; costo_queda: string }
        const entro = dec(fila.entro)
        const queda = dec(fila.queda)
        if (entro.isZero()) {
            throw problemaLinea(
                l.i,
                'producto_id',
                `El producto ${l.producto.sku} no entró a esa bodega con la compra ${referencia}`,
                'devolucion_excede_compra',
            )
        }
        if (l.cantidad.gt(queda)) {
            throw problemaLinea(
                l.i,
                'cantidad',
                `De la compra ${referencia} quedan por devolver ${queda.toFixed(3)} de ${l.producto.sku}`,
                'devolucion_excede_compra',
            )
        }
        costo = l.cantidad.eq(queda)
            ? dec(fila.costo_queda)
            : redondear(l.cantidad.times(dec(fila.costo_entro)).div(entro))
        const saldo = await saldoDe(t, l.producto.id, l.bodegaId)
        if (l.cantidad.gt(saldo.cantidad)) {
            throw new ExistenciaInsuficiente(l.producto, l.bodegaId, l.cantidad, saldo.cantidad)
        }
        const resto = { cantidad: saldo.cantidad.minus(l.cantidad), valor: saldo.valor.minus(costo) }
        if (resto.valor.lt(0) || (resto.cantidad.isZero() && !resto.valor.isZero())) {
            throw new Conflicto(
                `Devolver ${l.cantidad.toFixed(3)} de ${l.producto.sku} al costo de la compra (Q${aTexto(costo)}) dejaría la bodega ${l.bodegaId} con ${resto.cantidad.toFixed(3)} y Q${aTexto(resto.valor)}: corrige antes con un ajuste`,
                'valor_insuficiente',
                'Valor de inventario insuficiente',
            )
        }
    }
    if (!costo.eq(l.costo)) {
        throw new Problema(
            422,
            'devolucion_distinta_del_costo',
            'Devolución distinta del costo',
            `La línea ${l.i} de la NCRE vale Q${aTexto(l.costo)}${compra.credito ? ' sin IVA' : ''} y lo devuelto costó Q${aTexto(costo)} en la compra ${referencia}: la nota del proveedor por la devolución debe valer el costo de lo devuelto (otra diferencia va en otra línea, a su gasto)`,
            [
                {
                    field: `lineas.${l.i}.total`,
                    message: `Costo de lo devuelto: Q${aTexto(costo)}`,
                    rule: 'devolucion_distinta_del_costo',
                },
            ],
        )
    }
    l.costo = costo
}

/** Revierte lo que la compra (o la NCRE) movió en el kardex, al mismo costo, con el asiento de reverso. */
export async function revertirEntradasDeLaCompra(
    t: Transaccion,
    compraId: number,
    reverso: { id: number; fecha: string },
): Promise<void> {
    const movimientos = (await t.trx
        .from('inventario.movimientos as m')
        .where({ 'm.origen_tipo': 'compra', 'm.origen_id': compraId })
        .whereIn('m.tipo', ['entrada_compra', 'devolucion_proveedor'])
        .whereNotExists((q) => q.from('inventario.movimientos as r').whereRaw('r.reverso_de = m.id'))
        .orderBy('m.id')
        .select(
            'm.id',
            'm.empresa_id',
            'm.producto_id',
            'm.bodega_id',
            'm.cantidad',
            'm.costo_total',
            'm.unidad_id',
        )) as Array<{
        id: number
        empresa_id: number
        producto_id: number
        bodega_id: number
        cantidad: string
        costo_total: string
        unidad_id: number | null
    }>
    if (movimientos.length === 0) return
    for (const productoId of [...new Set(movimientos.map((e) => Number(e.producto_id)))].sort(
        (a, b) => a - b,
    )) {
        await bloquearProducto(t, productoId)
    }
    const empresaId = Number(movimientos[0]!.empresa_id)
    // unidades que entraron con la compra: todas siguen disponibles en su bodega (409 si no)
    const entradas = movimientos.filter((m) => m.unidad_id !== null && dec(m.cantidad).gt(0))
    if (entradas.length > 0) {
        const unidades = (await t.trx
            .from('inventario.unidades')
            .whereIn(
                'id',
                entradas.map((m) => Number(m.unidad_id)),
            )
            .orderBy('id')
            .forUpdate()
            .select(
                'id',
                'serie',
                'mac',
                'estado',
                'bodega_id',
                'costo',
                // H42: lo que la unidad hizo después de entrar (fuera de traslados): comodato, ajuste…
                // H54: IS DISTINCT FROM, porque los movimientos sin origen (comodato) también cuentan.
                // Una NCRE de devolución ya anulada (su salida y su reverso, al mismo costo) no cuenta.
                t.trx.raw(
                    `(SELECT count(*)::int FROM inventario.movimientos x
                       WHERE x.unidad_id = inventario.unidades.id AND x.tipo <> 'traslado'
                         AND (x.origen_tipo IS DISTINCT FROM 'compra' OR x.origen_id IS DISTINCT FROM ?)
                         AND NOT (x.origen_tipo = 'compra' AND x.tipo IN ('devolucion_proveedor', 'reverso_compra')
                                  AND EXISTS (SELECT 1 FROM ledger.compras_anulaciones an
                                               WHERE an.compra_id = x.origen_id))) as otros`,
                    [compraId],
                ),
            )) as Array<{
            id: number
            serie: string | null
            mac: string | null
            estado: string
            bodega_id: number | null
            costo: string
            otros: number
        }>
        const enUso = unidades.filter((u) => {
            const entrada = entradas.find((m) => Number(m.unidad_id) === Number(u.id))!
            // H42: solo si está tal como entró: disponible en su bodega, a su costo de compra y sin otro
            // movimiento que traslados (si volvió de un comodato vale su valor en libros: NCRE a su costo)
            return (
                u.estado !== 'disponible' ||
                Number(u.bodega_id) !== Number(entrada.bodega_id) ||
                !dec(u.costo).eq(dec(entrada.costo_total)) ||
                Number(u.otros) > 0
            )
        })
        if (enUso.length > 0) {
            throw new Conflicto(
                `La compra ${compraId} tiene unidades que ya no están disponibles en su bodega: ${enUso
                    .map((u) => `${u.serie ?? u.mac} (${u.estado.replaceAll('_', ' ')})`)
                    .join(
                        ', ',
                    )}. Una unidad que pasó por un comodato o un ajuste se devuelve al proveedor con una NCRE por serie; una trasladada, vuelve a su bodega antes de anular`,
                'unidades_en_uso',
                'Unidades en uso',
            )
        }
    }
    for (const m of movimientos) {
        const producto = await productoMovible(t, Number(m.producto_id))
        const bodegaId = Number(m.bodega_id)
        const cantidad = dec(m.cantidad)
        const costo = dec(m.costo_total)
        const unidadId = m.unidad_id === null ? null : Number(m.unidad_id)
        if (cantidad.gt(0)) {
            const saldo = await saldoDe(t, producto.id, bodegaId)
            if (cantidad.gt(saldo.cantidad)) {
                throw new ExistenciaInsuficiente(producto, bodegaId, cantidad, saldo.cantidad)
            }
            const queda = { cantidad: saldo.cantidad.minus(cantidad), valor: saldo.valor.minus(costo) }
            if (queda.valor.lt(0) || (queda.cantidad.isZero() && !queda.valor.isZero())) {
                throw new Conflicto(
                    `Anular la compra ${compraId} dejaría ${producto.sku} en la bodega ${bodegaId} con ${queda.cantidad.toFixed(3)} y Q${aTexto(queda.valor)}: parte de su costo ya salió al promedio. Devuelve lo que queda con una NCRE del proveedor o corrige con un ajuste`,
                    'valor_insuficiente',
                    'Valor de inventario insuficiente',
                )
            }
            if (unidadId) await actualizarUnidad(t, unidadId, { estado: 'anulada', bodega_id: null })
        } else if (unidadId) {
            // la NCRE anulada: la unidad devuelta vuelve a su bodega (si nadie registró ya ese equipo)
            const unidad = (await t.trx
                .from('inventario.unidades')
                .where('id', unidadId)
                .forUpdate()
                .first()) as {
                serie: string | null
                mac: string | null
            }
            const viva = await t.trx
                .from('inventario.unidades')
                .where('empresa_id', empresaId)
                .whereNot('id', unidadId)
                .whereNotIn('estado', ['anulada', 'devuelta_proveedor'])
                .where((q) => {
                    if (unidad.serie) q.orWhere('serie', unidad.serie)
                    if (unidad.mac) q.orWhere('mac', unidad.mac)
                })
                .select('id')
                .first()
            if (viva) {
                throw new Conflicto(
                    `La unidad ${unidad.serie ?? unidad.mac} ya se registró otra vez (unidad ${viva.id}): no puede volver`,
                    'serie_duplicada',
                    'Serie duplicada',
                )
            }
            await actualizarUnidad(t, unidadId, { estado: 'disponible', bodega_id: bodegaId })
        }
        await insertarMovimiento(t, {
            empresaId: Number(m.empresa_id),
            tipo: 'reverso_compra',
            fecha: reverso.fecha,
            producto,
            bodegaId,
            cantidad: cantidad.neg(),
            costoTotal: costo.neg(),
            unidadId,
            asientoId: reverso.id,
            origen: { tipo: 'compra', id: compraId },
            reversoDe: Number(m.id),
            motivo: `anulación de la compra ${compraId}`,
        })
    }
}

/**
 * Observación del auditor (fase B): en una NCRE, lo que pasa de lo que entró con la compra responde
 * 422 `devolucion_excede_compra` antes que `ncre_excede_saldo` (la causa es la cantidad, no el
 * monto). Solo mira las cantidades por producto y bodega; el resto lo valida `entradasDeLaCompra`.
 */
export async function exigirDevolucionDentroDeLaCompra(
    t: Transaccion,
    referenciaId: number,
    lineas: Array<Pick<LineaCompraCalculada, 'producto_id' | 'bodega_id' | 'cantidad' | 'unidad_ids'>>,
): Promise<void> {
    const pedido = new Map<string, { i: number; cantidad: Dec }>()
    lineas.forEach((l, i) => {
        if (!l.producto_id || !l.bodega_id) return
        const clave = `${l.producto_id}:${l.bodega_id}`
        const previo = pedido.get(clave)
        const cantidad = dec(String(l.unidad_ids.length > 0 ? l.unidad_ids.length : l.cantidad))
        pedido.set(clave, { i: previo?.i ?? i, cantidad: (previo?.cantidad ?? dec('0')).plus(cantidad) })
    })
    for (const [clave, { i, cantidad }] of pedido) {
        const [productoId, bodegaId] = clave.split(':').map(Number) as [number, number]
        const fila = (await t.trx
            .from('inventario.movimientos as m')
            .where({ 'm.producto_id': productoId, 'm.bodega_id': bodegaId, 'm.origen_tipo': 'compra' })
            .where((q) =>
                q
                    .where((e) => e.where('m.tipo', 'entrada_compra').where('m.origen_id', referenciaId))
                    .orWhere((d) =>
                        d
                            .where('m.tipo', 'devolucion_proveedor')
                            .whereIn(
                                'm.origen_id',
                                t.trx
                                    .from('ledger.compras')
                                    .where('compra_referencia_id', referenciaId)
                                    .select('id'),
                            ),
                    ),
            )
            .whereNotExists((q) => q.from('inventario.movimientos as r').whereRaw('r.reverso_de = m.id'))
            .select(t.trx.raw('coalesce(sum(m.cantidad), 0)::text as queda'))
            .first()) as { queda: string }
        const queda = dec(fila.queda)
        if (cantidad.gt(queda)) {
            throw problemaLinea(
                i,
                'cantidad',
                `De la compra ${referenciaId} quedan por devolver ${queda.toFixed(3)} de ese producto en esa bodega`,
                'devolucion_excede_compra',
            )
        }
    }
}
