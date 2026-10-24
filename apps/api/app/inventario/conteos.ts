import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { filtrarBodegasVisibles, type AccesoBodegas } from '#inventario/bodegas'
import { EN_BODEGA, normalizarMac, normalizarSerie } from '#inventario/unidades'

/**
 * Conteos físicos (`contratos/inventario.md` §4 y §5, fase C): lectura y la comparación de lo contado
 * con lo esperado. Las acciones (`inventario.abrir_conteo`, `contar`, `cerrar_conteo`,
 * `cancelar_conteo`) viven en `actions/`.
 *
 * - Por cantidad: esperado = existencia de la bodega **al capturar la línea** (H56); diferencia =
 *   contado − esperado. El
 *   faltante sale al promedio (`5.6.02 / 1.1.14`) y el sobrante entra al promedio de la bodega (sin
 *   existencia, al `costo_unitario` de la línea o al último costo del producto; `1.1.14 / 4.2.04`).
 * - Por serie: las series o MAC contadas contra las unidades que había al capturar (`planDeLinea`).
 *   Las que faltan salen a su costo y quedan `dada_de_baja`; las que sobran entran como unidades nuevas
 *   (usadas) al costo de la línea o al último costo del producto.
 */

export const ESTADOS_CONTEO = ['abierto', 'cerrado', 'cancelado'] as const
export type EstadoConteo = (typeof ESTADOS_CONTEO)[number]

export interface LineaConteoVista {
    id: number
    producto_id: number
    producto_sku: string
    producto_nombre: string
    seguimiento: string
    contado: string
    series: string[]
    costo_unitario: string | null
    /** lo que había al capturar la línea (H56); cerrado, lo guardado al cerrar */
    esperado: string
    diferencia: string
    /** valor de la diferencia (negativo = faltante); abierto, estimado al costo de hoy */
    valor_diferencia: string | null
    /** H56: cuándo se capturó y lo que había en la bodega en ese momento */
    capturado_en: Date | null
    esperado_captura: string | null
    valor_captura: string | null
    /** movimientos del producto en la bodega después de la captura (no son diferencia del conteo) */
    movimientos_desde_captura: number
}

export interface ConteoVista {
    id: number
    empresa_id: number
    bodega_id: number
    bodega_nombre: string
    estado: EstadoConteo
    fecha_corte: string
    motivo: string | null
    abierto_por: number | null
    cerrado_por: number | null
    cerrado_en: Date | null
    faltante: string
    sobrante: string
    version: number
    created_at: Date
    lineas?: LineaConteoVista[]
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('inventario.conteos as c')
        .join('inventario.bodegas as b', 'b.id', 'c.bodega_id')
        .select(
            'c.id',
            'c.empresa_id',
            'c.bodega_id',
            'b.nombre as bodega_nombre',
            'c.estado',
            cliente.raw(`to_char(c.fecha_corte, 'YYYY-MM-DD') as fecha_corte`),
            'c.motivo',
            'c.abierto_por',
            'c.cerrado_por',
            'c.cerrado_en',
            cliente.raw('c.faltante::text as faltante'),
            cliente.raw('c.sobrante::text as sobrante'),
            'c.version',
            'c.created_at',
        )
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizar(f: ConteoVista): ConteoVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        bodega_id: Number(f.bodega_id),
        abierto_por: n(f.abierto_por),
        cerrado_por: n(f.cerrado_por),
        version: Number(f.version),
    }
}

/** ¿El valor contado es esta unidad? Coincide con su serie o con su MAC (normalizadas). */
export function coincide(valor: string, unidad: { serie: string | null; mac: string | null }): boolean {
    const serie = normalizarSerie(valor)
    const mac = normalizarMac(valor)
    return (serie !== null && serie === unidad.serie) || (mac !== null && mac === unidad.mac)
}

/**
 * Unidad nueva de un valor contado que no es de la bodega: MAC si se escribió como MAC (con `:` o
 * `-`), si no, serie.
 */
export function unidadContada(valor: string): { serie: string | null; mac: string | null } {
    const mac = /[:-]/.test(valor) ? normalizarMac(valor) : null
    return mac ? { serie: null, mac } : { serie: normalizarSerie(valor), mac: null }
}

export interface FilaLinea {
    id: number
    producto_id: number
    producto_sku: string
    producto_nombre: string
    seguimiento: string
    contado: string
    series: string[]
    costo_unitario: string | null
    esperado: string | null
    diferencia: string | null
    valor_diferencia: string | null
    esperado_captura: string | null
    valor_captura: string | null
    unidades_captura: number[] | null
    ultimo_movimiento_id: number | null
    capturado_en: Date | null
}

export async function lineasDelConteo(cliente: QueryClientContract, conteoId: number): Promise<FilaLinea[]> {
    return (await cliente
        .from('inventario.conteo_lineas as l')
        .join('inventario.productos as p', 'p.id', 'l.producto_id')
        .where('l.conteo_id', conteoId)
        .orderBy('l.producto_id')
        .select(
            'l.id',
            'l.producto_id',
            'p.sku as producto_sku',
            'p.nombre as producto_nombre',
            'p.seguimiento',
            cliente.raw('l.contado::text as contado'),
            'l.series',
            cliente.raw('l.costo_unitario::text as costo_unitario'),
            cliente.raw('l.esperado::text as esperado'),
            cliente.raw('l.diferencia::text as diferencia'),
            cliente.raw('l.valor_diferencia::text as valor_diferencia'),
            cliente.raw('l.esperado_captura::text as esperado_captura'),
            cliente.raw('l.valor_captura::text as valor_captura'),
            'l.unidades_captura',
            'l.ultimo_movimiento_id',
            'l.capturado_en',
        )) as FilaLinea[]
}

export interface UnidadDeBodega {
    id: number
    serie: string | null
    mac: string | null
    costo: string
}

/**
 * Lo que una línea ajusta (H56): la diferencia es **contado − esperado al capturar**; lo que se movió
 * en la bodega después de la captura ya está en el kardex.
 *
 * - Por cantidad: `diferencia` = contado − cantidad al capturar.
 * - Por serie: faltan las unidades que estaban al capturar, no se contaron y **siguen** en la bodega (las
 *   que salieron después ya tienen su movimiento); sobran las series contadas que no eran de la bodega
 *   al capturar ni lo son ahora.
 *
 * Una línea sin captura guardada (anterior a H56) toma lo de ahora.
 */
export async function planDeLinea(
    cliente: QueryClientContract,
    bodegaId: number,
    l: FilaLinea,
): Promise<{
    esperado: Dec
    diferencia: Dec
    faltan: UnidadDeBodega[]
    nuevas: string[]
    saldo: { cantidad: Dec; valor: Dec }
    movimientosDesdeCaptura: number
}> {
    const fila = (await cliente
        .from('inventario.saldos')
        .where({ producto_id: l.producto_id, bodega_id: bodegaId })
        .select('cantidad', 'valor')
        .first()) as { cantidad: string; valor: string } | null
    const saldo = { cantidad: dec(fila?.cantidad ?? '0'), valor: dec(fila?.valor ?? '0') }
    const posteriores = (await cliente
        .from('inventario.movimientos')
        .where({ producto_id: l.producto_id, bodega_id: bodegaId })
        .if(l.ultimo_movimiento_id !== null, (q) => q.where('id', '>', l.ultimo_movimiento_id!))
        // los ajustes del propio cierre no cuentan (un conteo abierto por bodega)
        .whereRaw(`origen_tipo IS DISTINCT FROM 'conteo'`)
        .if(l.ultimo_movimiento_id === null && l.capturado_en === null, (q) => q.whereRaw('false'))
        .count('* as n')
        .first()) as { n: string | number }
    const movimientosDesdeCaptura = Number(posteriores.n)
    if (l.seguimiento === 'serie') {
        const ahora = (await cliente
            .from('inventario.unidades')
            .where({ producto_id: l.producto_id, bodega_id: bodegaId })
            .whereIn('estado', EN_BODEGA as string[])
            .orderBy('id')
            .select('id', 'serie', 'mac', 'costo')) as UnidadDeBodega[]
        const capturadas = l.unidades_captura ?? ahora.map((u) => Number(u.id))
        const alCapturar =
            capturadas.length === 0
                ? []
                : ((await cliente
                      .from('inventario.unidades')
                      .whereIn('id', capturadas)
                      .select('id', 'serie', 'mac', 'costo')) as UnidadDeBodega[])
        const faltan = ahora.filter(
            (u) => capturadas.includes(Number(u.id)) && !l.series.some((v) => coincide(v, u)),
        )
        const nuevas = l.series.filter(
            (v) => !alCapturar.some((u) => coincide(v, u)) && !ahora.some((u) => coincide(v, u)),
        )
        return {
            esperado: dec(String(capturadas.length)),
            diferencia: dec(String(l.series.length - capturadas.length)),
            faltan,
            nuevas,
            saldo,
            movimientosDesdeCaptura,
        }
    }
    const esperado = l.esperado_captura === null ? saldo.cantidad : dec(l.esperado_captura)
    return {
        esperado,
        diferencia: dec(l.contado).minus(esperado),
        faltan: [],
        nuevas: [],
        saldo,
        movimientosDesdeCaptura,
    }
}

/** Vista previa de una línea abierta: su plan valuado al costo de hoy (null si no hay costo conocido). */
async function estimar(
    cliente: QueryClientContract,
    bodegaId: number,
    l: FilaLinea,
): Promise<{ esperado: Dec; diferencia: Dec; valor: Dec | null; movimientos: number }> {
    const plan = await planDeLinea(cliente, bodegaId, l)
    const { cantidad, valor } = plan.saldo
    const promedio = cantidad.gt(0) ? valor.div(cantidad) : l.costo_unitario ? dec(l.costo_unitario) : null
    let estimado: Dec | null
    if (l.seguimiento === 'serie') {
        const costoFaltante = plan.faltan.reduce((s, u) => s.plus(dec(u.costo)), CERO)
        estimado =
            promedio || plan.nuevas.length === 0
                ? redondear((promedio ?? CERO).times(plan.nuevas.length).minus(costoFaltante))
                : null
    } else {
        estimado = plan.diferencia.isZero()
            ? CERO
            : promedio
              ? redondear(plan.diferencia.times(promedio))
              : null
    }
    return {
        esperado: plan.esperado,
        diferencia: plan.diferencia,
        valor: estimado,
        movimientos: plan.movimientosDesdeCaptura,
    }
}

export async function verConteo(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConteoVista> {
    const fila = (await consulta(cliente).where('c.id', id).first()) as ConteoVista | null
    if (!fila) throw new NoEncontrado(`El conteo ${id} no existe`)
    const conteo = normalizar(fila)
    const lineas = await lineasDelConteo(cliente, id)
    conteo.lineas = []
    for (const l of lineas) {
        const cerrado = conteo.estado === 'cerrado' && l.esperado !== null
        const estimado = cerrado ? null : await estimar(cliente, conteo.bodega_id, l)
        let movimientos = estimado?.movimientos ?? 0
        if (!estimado) {
            const plan = await planDeLinea(cliente, conteo.bodega_id, l)
            movimientos = plan.movimientosDesdeCaptura
        }
        conteo.lineas.push({
            id: Number(l.id),
            producto_id: Number(l.producto_id),
            producto_sku: l.producto_sku,
            producto_nombre: l.producto_nombre,
            seguimiento: l.seguimiento,
            contado: l.contado,
            series: l.series,
            costo_unitario: l.costo_unitario,
            esperado: cerrado ? l.esperado! : estimado!.esperado.toFixed(3),
            diferencia: cerrado ? l.diferencia! : estimado!.diferencia.toFixed(3),
            valor_diferencia: cerrado
                ? l.valor_diferencia
                : estimado!.valor === null
                  ? null
                  : aTexto(estimado!.valor),
            capturado_en: l.capturado_en,
            esperado_captura: l.esperado_captura,
            valor_captura: l.valor_captura,
            movimientos_desde_captura: movimientos,
        })
    }
    return conteo
}

export async function empresaDeConteo(id: number): Promise<{ empresa_id: number; bodega_id: number }> {
    const fila = await db.from('inventario.conteos').where('id', id).select('empresa_id', 'bodega_id').first()
    if (!fila) throw new NoEncontrado(`El conteo ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id), bodega_id: Number(fila.bodega_id) }
}

export interface FiltrosConteos extends OpcionesPaginacion {
    bodega_id?: number
    estado?: EstadoConteo
}

export async function listarConteos(
    filtros: FiltrosConteos,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
) {
    const q = consulta(db.connection())
        .if(filtros.bodega_id, (c) => c.where('c.bodega_id', filtros.bodega_id!))
        .if(filtros.estado, (c) => c.where('c.estado', filtros.estado!))
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('c.empresa_id', ids))
    filtrarBodegasVisibles(q, acceso)
    const pagina = await paginar<ConteoVista>(q, filtros, { columna: 'c.id' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}
