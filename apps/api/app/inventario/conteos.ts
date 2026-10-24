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
 * - Por cantidad: esperado = existencia de la bodega al cerrar; diferencia = contado − esperado. El
 *   faltante sale al promedio (`5.6.02 / 1.1.14`) y el sobrante entra al promedio de la bodega (sin
 *   existencia, al `costo_unitario` de la línea o al último costo del producto; `1.1.14 / 4.2.04`).
 * - Por serie: las series o MAC contadas contra las unidades de la bodega (disponibles o en reparación).
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
    /** al cerrar, lo guardado; abierto, lo que hay hoy en la bodega */
    esperado: string
    diferencia: string
    /** valor de la diferencia (negativo = faltante); abierto, estimado al costo de hoy */
    valor_diferencia: string | null
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
        )) as FilaLinea[]
}

/** Lo esperado hoy de una línea en la bodega y su diferencia estimada (vista previa del conteo). */
async function estimar(
    cliente: QueryClientContract,
    bodegaId: number,
    l: FilaLinea,
): Promise<{ esperado: Dec; diferencia: Dec; valor: Dec | null }> {
    const saldo = (await cliente
        .from('inventario.saldos')
        .where({ producto_id: l.producto_id, bodega_id: bodegaId })
        .select('cantidad', 'valor')
        .first()) as { cantidad: string; valor: string } | null
    const cantidad = dec(saldo?.cantidad ?? '0')
    const valor = dec(saldo?.valor ?? '0')
    if (l.seguimiento === 'serie') {
        const unidades = (await cliente
            .from('inventario.unidades')
            .where({ producto_id: l.producto_id, bodega_id: bodegaId })
            .whereIn('estado', EN_BODEGA as string[])
            .select('serie', 'mac', 'costo')) as Array<{
            serie: string | null
            mac: string | null
            costo: string
        }>
        const faltan = unidades.filter((u) => !l.series.some((v) => coincide(v, u)))
        const sobran = l.series.length - (unidades.length - faltan.length)
        const costoFaltante = faltan.reduce((s, u) => s.plus(dec(u.costo)), CERO)
        // la regla del cierre: con existencia, al promedio de la bodega
        const unitario = cantidad.gt(0)
            ? valor.div(cantidad)
            : l.costo_unitario
              ? dec(l.costo_unitario)
              : null
        return {
            esperado: dec(String(unidades.length)),
            diferencia: dec(String(l.series.length - unidades.length)),
            valor:
                unitario || sobran === 0
                    ? redondear((unitario ?? CERO).times(sobran).minus(costoFaltante))
                    : null,
        }
    }
    const diferencia = dec(l.contado).minus(cantidad)
    const promedio = cantidad.gt(0) ? valor.div(cantidad) : l.costo_unitario ? dec(l.costo_unitario) : null
    return {
        esperado: cantidad,
        diferencia,
        valor: diferencia.isZero() ? CERO : promedio ? redondear(diferencia.times(promedio)) : null,
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
