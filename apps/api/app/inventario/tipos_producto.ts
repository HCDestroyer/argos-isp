import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { Seguimiento } from '#inventario/productos'

/**
 * Tipos de producto editables (fase D, `contratos/inventario.md` D.2): catálogo por empresa o global
 * (`empresa_id` null) con el seguimiento y la modalidad por defecto de sus productos. `productos.tipo`
 * guarda el código (la API no cambia) y `productos.tipo_id` el tipo. Un código se resuelve primero en
 * la empresa y luego entre los globales.
 *
 * Modalidad (D.3): `comodato` (solo serie), `consumible_gasto` (solo cantidad) o `consumible_cobro`
 * (las dos; por serie es la venta de un equipo).
 */

export const MODALIDADES = ['comodato', 'consumible_gasto', 'consumible_cobro'] as const
export type Modalidad = (typeof MODALIDADES)[number]

/** Modalidad por defecto de un seguimiento (la de los productos de antes de la fase D). */
export function modalidadPorDefecto(seguimiento: Seguimiento): Modalidad {
    return seguimiento === 'serie' ? 'comodato' : 'consumible_gasto'
}

/** Error de campo si la modalidad no va con el seguimiento; null si va. */
export function problemaModalidad(
    modalidad: Modalidad,
    seguimiento: Seguimiento,
    campo = 'modalidad',
): ErrorCampo | null {
    if (modalidad === 'comodato' && seguimiento !== 'serie') {
        return { field: campo, message: 'El comodato es de equipos por serie', rule: 'modalidad' }
    }
    if (modalidad === 'consumible_gasto' && seguimiento !== 'cantidad') {
        return {
            field: campo,
            message: 'Un equipo por serie no va a gasto: se presta en comodato o se cobra (consumible_cobro)',
            rule: 'modalidad',
        }
    }
    return null
}

export interface TipoProductoVista {
    id: number
    /** null = global */
    empresa_id: number | null
    codigo: string
    nombre: string
    seguimiento_defecto: Seguimiento
    modalidad_defecto: Modalidad
    activo: boolean
    version: number
    created_at: Date
    updated_at: Date
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'codigo',
    'nombre',
    'seguimiento_defecto',
    'modalidad_defecto',
    'activo',
    'version',
    'created_at',
    'updated_at',
] as const

function normalizar(f: TipoProductoVista): TipoProductoVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: f.empresa_id === null ? null : Number(f.empresa_id),
        version: Number(f.version),
    }
}

export async function verTipoProducto(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('inventario.tipos_producto')
        .where('id', id)
        .select([...COLUMNAS])
        .first()) as TipoProductoVista | null
    if (!fila) throw new NoEncontrado(`El tipo de producto ${id} no existe`)
    return normalizar(fila)
}

/**
 * Tipo de un producto por su código: el de la empresa o, si no hay, el global; activo. 422 en `campo`
 * (`tipo`) si no existe o está desactivado.
 */
export async function resolverTipo(
    t: Transaccion,
    empresaId: number,
    codigo: string,
    campo = 'tipo',
): Promise<TipoProductoVista> {
    const filas = (await t.trx
        .from('inventario.tipos_producto')
        .where('codigo', codigo.trim().toLowerCase())
        .where((q) => q.where('empresa_id', empresaId).orWhereNull('empresa_id'))
        .orderByRaw('empresa_id IS NULL')
        .select([...COLUMNAS])) as TipoProductoVista[]
    const tipo = filas[0]
    if (!tipo) {
        throw new ValidacionFallida([
            { field: campo, message: `El tipo de producto ${codigo} no existe`, rule: 'tipo' },
        ])
    }
    if (!tipo.activo) {
        throw new ValidacionFallida([
            {
                field: campo,
                message: `El tipo de producto ${codigo} está desactivado`,
                rule: 'tipo_inactivo',
            },
        ])
    }
    return normalizar(tipo)
}

export interface FiltrosTiposProducto extends OpcionesPaginacion {
    activo?: boolean
}

/** Los tipos globales y los de las empresas visibles. */
export async function listarTiposProducto(filtros: FiltrosTiposProducto, empresas: number[] | null) {
    const q = db
        .from('inventario.tipos_producto')
        .select([...COLUMNAS])
        .if(filtros.activo !== undefined, (c) => c.where('activo', filtros.activo!))
    if (empresas) q.where((c) => c.whereNull('empresa_id').orWhereIn('empresa_id', empresas))
    const pagina = await paginar<TipoProductoVista>(q, filtros, { columna: 'id', direccion: 'asc' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}
