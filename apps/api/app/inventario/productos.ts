import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, type ErrorCampo } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Productos del inventario (`contratos/inventario.md` §4): lectura y validación común de las
 * acciones `productos.crear` y `productos.editar`.
 */

export const TIPOS_PRODUCTO = ['equipo', 'material', 'otro'] as const
export type TipoProducto = (typeof TIPOS_PRODUCTO)[number]
export const SEGUIMIENTOS = ['cantidad', 'serie'] as const
export type Seguimiento = (typeof SEGUIMIENTOS)[number]

/** Clase de activo por defecto de un producto con seguimiento por serie (comodato, fase B). */
export const CLASE_ACTIVO_POR_DEFECTO = 'equipo_red'
/** Cuentas por defecto de cada producto (§3). */
export const CUENTA_COSTO_POR_DEFECTO = CUENTAS_GT.COSTO_EQUIPO_VENDIDO
export const CUENTA_CONSUMO_POR_DEFECTO = CUENTAS_GT.MATERIALES_INSTALACION

export interface ProductoVista {
    id: number
    empresa_id: number
    sku: string
    nombre: string
    unidad: string
    tipo: TipoProducto
    seguimiento: Seguimiento
    clase_activo: string | null
    concepto_cargo_id: number | null
    /** null = la del plan (`5.6.01`) */
    cuenta_costo: string | null
    /** null = la del plan (`5.2.07`) */
    cuenta_consumo: string | null
    existencia_minima: string | null
    /** precio de venta sugerido para el cargo único, IVA incluido; null = sin precio */
    precio_venta: string | null
    activo: boolean
    /** existencia total en todas las bodegas */
    existencia: string
    /** valor total del kardex del producto */
    valor: string
    version: number
    created_at: Date
    updated_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('inventario.productos as p')
        .select(
            'p.id',
            'p.empresa_id',
            'p.sku',
            'p.nombre',
            'p.unidad',
            'p.tipo',
            'p.seguimiento',
            'p.clase_activo',
            'p.concepto_cargo_id',
            'p.cuenta_costo',
            'p.cuenta_consumo',
            cliente.raw('p.existencia_minima::text as existencia_minima'),
            cliente.raw('p.precio_venta::text as precio_venta'),
            'p.activo',
            cliente.raw(
                `coalesce((SELECT sum(s.cantidad) FROM inventario.saldos s WHERE s.producto_id = p.id), 0)::numeric(14,3)::text as existencia`,
            ),
            cliente.raw(
                `coalesce((SELECT sum(s.valor) FROM inventario.saldos s WHERE s.producto_id = p.id), 0)::numeric(14,2)::text as valor`,
            ),
            'p.version',
            'p.created_at',
            'p.updated_at',
        )
}

function normalizar(fila: ProductoVista): ProductoVista {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        concepto_cargo_id: fila.concepto_cargo_id === null ? null : Number(fila.concepto_cargo_id),
        version: Number(fila.version),
    }
}

export async function verProducto(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consulta(cliente).where('p.id', id).first()) as ProductoVista | null
    if (!fila) throw new NoEncontrado(`El producto ${id} no existe`)
    return normalizar(fila)
}

export interface FiltrosProductos extends OpcionesPaginacion {
    q?: string
    tipo?: TipoProducto
    seguimiento?: Seguimiento
    activo?: boolean
}

export async function listarProductos(filtros: FiltrosProductos, empresas: number[] | null) {
    const q = consulta(db.connection())
        .if(filtros.q, (c) =>
            c.where((w) =>
                w
                    .whereILike('p.nombre', `%${filtros.q!}%`)
                    .orWhereRaw('upper(p.sku) = upper(?)', [filtros.q!]),
            ),
        )
        .if(filtros.tipo, (c) => c.where('p.tipo', filtros.tipo!))
        .if(filtros.seguimiento, (c) => c.where('p.seguimiento', filtros.seguimiento!))
        .if(filtros.activo !== undefined, (c) => c.where('p.activo', filtros.activo!))
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('p.empresa_id', ids))
    const pagina = await paginar<ProductoVista>(q, filtros, { columna: 'p.id' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}

export async function empresaDeProducto(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('inventario.productos').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El producto ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/**
 * Cuenta de costo o de consumo de un producto: una de gasto imputable, activa y común o de la
 * empresa; nunca `1.1.14` (el kardex tiene una sola cuenta, §3). Devuelve el error o null.
 */
export async function problemaCuentaProducto(
    cliente: QueryClientContract,
    codigo: string,
    empresaId: number,
    campo: string,
): Promise<ErrorCampo | null> {
    const fila = (await cliente
        .from('ledger.cuentas')
        .where({ pais: PAIS_PLAN, codigo })
        .select('tipo', 'imputable', 'activa', 'empresa_id')
        .first()) as { tipo: string; imputable: boolean; activa: boolean; empresa_id: number | null } | null
    if (!fila) return { field: campo, message: `La cuenta ${codigo} no existe`, rule: 'exists' }
    if (fila.tipo !== 'gasto' || !fila.imputable || !fila.activa) {
        return {
            field: campo,
            message: `La cuenta ${codigo} debe ser de gasto, imputable y activa`,
            rule: 'cuenta_producto',
        }
    }
    if (fila.empresa_id !== null && Number(fila.empresa_id) !== empresaId) {
        return { field: campo, message: `La cuenta ${codigo} es de otra empresa`, rule: 'cuenta_producto' }
    }
    return null
}
