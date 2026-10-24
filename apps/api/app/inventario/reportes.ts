import db from '@adonisjs/lucid/services/db'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { filtrarBodegasVisibles, type AccesoBodegas } from '#inventario/bodegas'
import { valorKardex } from '#inventario/kardex'

/**
 * Reporte valorizado del inventario (`contratos/inventario.md` §8, fase C): existencias y valor por
 * producto y bodega **a una fecha**, reconstruidos del kardex (suma de los movimientos con fecha ≤ la
 * pedida), y el cuadre por empresa del kardex completo contra el saldo de `1.1.14` del libro a esa
 * fecha (el cuadre no se filtra por bodega ni producto: es de la empresa).
 */

export interface FiltrosValorizado {
    fecha?: string
    bodega_id?: number
    producto_id?: number
    /** incluye filas con existencia 0 y valor 0 (por defecto no) */
    con_ceros?: boolean
}

export interface FilaValorizada {
    empresa_id: number
    producto_id: number
    producto_sku: string
    producto_nombre: string
    unidad: string
    seguimiento: string
    bodega_id: number
    bodega_nombre: string
    cantidad: string
    valor: string
    /** valor / cantidad (6 decimales); null sin existencia */
    costo_promedio: string | null
}

export interface CuadreValorizado {
    empresa_id: number
    valor_kardex: string
    saldo_libro: string
    diferencia: string
}

export async function inventarioValorizado(
    filtros: FiltrosValorizado,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
): Promise<{ fecha: string; data: FilaValorizada[]; total: string; cuadre: CuadreValorizado[] }> {
    const fecha = filtros.fecha ?? hoyGuatemala()
    const q = db
        .from('inventario.movimientos as m')
        .join('inventario.productos as p', 'p.id', 'm.producto_id')
        .join('inventario.bodegas as b', 'b.id', 'm.bodega_id')
        .where('m.fecha', '<=', fecha)
        .if(filtros.bodega_id, (c) => c.where('m.bodega_id', filtros.bodega_id!))
        .if(filtros.producto_id, (c) => c.where('m.producto_id', filtros.producto_id!))
        .groupBy(
            'm.empresa_id',
            'm.producto_id',
            'p.sku',
            'p.nombre',
            'p.unidad',
            'p.seguimiento',
            'm.bodega_id',
            'b.nombre',
        )
        .orderBy([
            { column: 'm.empresa_id' },
            { column: 'p.sku' },
            { column: 'b.nombre' },
            { column: 'm.bodega_id' },
        ])
        .select(
            'm.empresa_id',
            'm.producto_id',
            'p.sku as producto_sku',
            'p.nombre as producto_nombre',
            'p.unidad',
            'p.seguimiento',
            'm.bodega_id',
            'b.nombre as bodega_nombre',
            db.raw('sum(m.cantidad)::text as cantidad'),
            db.raw('sum(m.costo_total)::text as valor'),
        )
    if (!filtros.con_ceros) q.havingRaw('sum(m.cantidad) <> 0 OR sum(m.costo_total) <> 0')
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('m.empresa_id', ids))
    filtrarBodegasVisibles(q, acceso)
    const filas = (await q) as Array<Omit<FilaValorizada, 'costo_promedio'>>
    let total = dec('0')
    const data = filas.map((f) => {
        const cantidad = dec(f.cantidad)
        const valor = dec(f.valor)
        total = total.plus(valor)
        return {
            ...f,
            empresa_id: Number(f.empresa_id),
            producto_id: Number(f.producto_id),
            bodega_id: Number(f.bodega_id),
            cantidad: cantidad.toFixed(3),
            valor: aTexto(valor),
            costo_promedio: cantidad.gt(0) ? valor.div(cantidad).toFixed(6) : null,
        }
    })

    const ids =
        empresas ??
        (
            (await db.from('inventario.movimientos').distinct('empresa_id').orderBy('empresa_id')) as Array<{
                empresa_id: number
            }>
        ).map((f) => Number(f.empresa_id))
    const cuadre: CuadreValorizado[] = []
    for (const empresaId of ids) {
        const kardex = await valorKardex(empresaId, fecha)
        const libro = (await db
            .from('ledger.movimientos as lm')
            .join('ledger.asientos as a', 'a.id', 'lm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'lm.cuenta_id')
            .where('a.empresa_id', empresaId)
            .where('c.codigo', CUENTAS_GT.INVENTARIOS)
            .where('a.fecha', '<=', fecha)
            .select(db.raw('coalesce(sum(lm.debe - lm.haber), 0)::text as saldo'))
            .first()) as { saldo: string }
        const saldo = dec(libro.saldo)
        cuadre.push({
            empresa_id: empresaId,
            valor_kardex: aTexto(kardex),
            saldo_libro: aTexto(saldo),
            diferencia: aTexto(saldo.minus(kardex)),
        })
    }
    return { fecha, data, total: aTexto(total), cuadre }
}
