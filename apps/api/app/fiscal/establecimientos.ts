import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'

/**
 * Establecimientos de la SAT por empresa (`fiscal.establecimientos`; contrato §3.2). Decisión del
 * PM: uno por empresa; el modelo admite varios (asignables a zona o caja más adelante) y exactamente
 * uno `por_defecto` activo, que es el que usará la FEL.
 */

export interface EstablecimientoVista {
    id: number
    empresa_id: number
    codigo: number
    nombre: string
    direccion: string | null
    municipio: string | null
    departamento: string | null
    activo: boolean
    por_defecto: boolean
    version: number
    created_at: string
    updated_at: string
}

export const CAMPOS_ESTABLECIMIENTO = [
    'codigo',
    'nombre',
    'direccion',
    'municipio',
    'departamento',
    'activo',
    'por_defecto',
] as const

function aVista(fila: Record<string, unknown>): EstablecimientoVista {
    return {
        ...(fila as unknown as EstablecimientoVista),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        codigo: Number(fila.codigo),
        version: Number(fila.version),
        created_at: new Date(fila.created_at as string).toISOString(),
        updated_at: new Date(fila.updated_at as string).toISOString(),
    }
}

/** Establecimientos de las empresas pedidas (null = todas), el por defecto primero. */
export async function listarEstablecimientos(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<EstablecimientoVista[]> {
    const filas = (await cliente
        .from('fiscal.establecimientos')
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .orderBy([
            { column: 'empresa_id', order: 'asc' },
            { column: 'por_defecto', order: 'desc' },
            { column: 'codigo', order: 'asc' },
        ])
        .select('*')) as Array<Record<string, unknown>>
    return filas.map(aVista)
}

export async function verEstablecimiento(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstablecimientoVista> {
    const fila = (await cliente
        .from('fiscal.establecimientos')
        .where('id', id)
        .select('*')
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El establecimiento ${id} no existe`)
    return aVista(fila)
}

/** Lo que va a `audit.cambios` (sin columnas de control). */
export function camposAuditables(e: EstablecimientoVista) {
    return Object.fromEntries(CAMPOS_ESTABLECIMIENTO.map((c) => [c, e[c]]))
}
