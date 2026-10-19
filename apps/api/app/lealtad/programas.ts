import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { dec, type Dec } from '#ledger/dinero'

/**
 * Programa de lealtad de una empresa (`contratos/lealtad.md` §3 y §6): lecturas y cálculos que
 * comparten las acciones. Un programa activo por empresa (índice parcial en la base).
 */

export interface ProgramaVista {
    id: number
    empresa_id: number
    nombre: string
    activo: boolean
    /** Q por punto */
    valor_punto: string
    /** NIIF 15: los puntos son un pasivo (`2.1.10`); false = solo un indicador (sin asientos) */
    diferimiento: boolean
    /** probabilidad de canje en %, p. ej. "100.000000" */
    canje_esperado_pct: string
    /** valor contable de un punto: `valor_punto × canje_esperado_pct / 100` (con 6 decimales) */
    valor_pasivo_punto: string
    /** null = los puntos no vencen */
    vencimiento_meses: number | null
    aviso_vencimiento_dias: number
    minimo_canje: number
    terminos: string
    terminos_hash: string
    vigente_desde: string
    vigente_hasta: string | null
    version: number
    created_at: Date
    updated_at: Date
}

/** Columnas editables (las que registran `audit.cambios` y `lealtad.programa_cambiado`). */
export const CAMPOS_PROGRAMA = [
    'nombre',
    'activo',
    'valor_punto',
    'diferimiento',
    'canje_esperado_pct',
    'vencimiento_meses',
    'aviso_vencimiento_dias',
    'minimo_canje',
    'terminos',
    'terminos_hash',
    'vigente_desde',
    'vigente_hasta',
] as const

export function hashTerminos(terminos: string): string {
    return createHash('sha256').update(terminos, 'utf8').digest('hex')
}

/** Valor contable de `puntos` en un programa con diferimiento, redondeado a centavos al final. */
export function valorDePuntos(
    programa: Pick<ProgramaVista, 'valor_punto' | 'canje_esperado_pct' | 'diferimiento'>,
    puntos: number,
): Dec {
    if (!programa.diferimiento) return dec('0')
    return dec(String(puntos))
        .times(dec(programa.valor_punto))
        .times(dec(programa.canje_esperado_pct))
        .dividedBy(100)
        .toDecimalPlaces(2)
}

function columnas(cliente: QueryClientContract) {
    return [
        'p.id',
        'p.empresa_id',
        'p.nombre',
        'p.activo',
        'p.valor_punto',
        'p.diferimiento',
        'p.canje_esperado_pct',
        'p.vencimiento_meses',
        'p.aviso_vencimiento_dias',
        'p.minimo_canje',
        'p.terminos',
        'p.terminos_hash',
        cliente.raw(`to_char(p.vigente_desde, 'YYYY-MM-DD') as vigente_desde`),
        cliente.raw(`to_char(p.vigente_hasta, 'YYYY-MM-DD') as vigente_hasta`),
        'p.version',
        'p.created_at',
        'p.updated_at',
    ]
}

function aVista(fila: Record<string, any>): ProgramaVista {
    const vista = {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        vencimiento_meses: fila.vencimiento_meses === null ? null : Number(fila.vencimiento_meses),
        aviso_vencimiento_dias: Number(fila.aviso_vencimiento_dias),
        minimo_canje: Number(fila.minimo_canje),
        version: Number(fila.version),
    } as ProgramaVista
    vista.valor_pasivo_punto = dec(vista.valor_punto)
        .times(dec(vista.canje_esperado_pct))
        .dividedBy(100)
        .toFixed(6)
    return vista
}

export async function verPrograma(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<ProgramaVista> {
    const consulta = cliente.from('lealtad.programas as p').where('p.id', id).select(columnas(cliente))
    if (bloquear) consulta.forUpdate()
    const fila = await consulta.first()
    if (!fila) throw new NoEncontrado(`El programa de lealtad ${id} no existe`)
    return aVista(fila)
}

/** Programa activo de la empresa, o null. */
export async function programaActivo(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ProgramaVista | null> {
    const fila = await cliente
        .from('lealtad.programas as p')
        .where('p.empresa_id', empresaId)
        .where('p.activo', true)
        .select(columnas(cliente))
        .first()
    return fila ? aVista(fila) : null
}

/** El programa que muestra el panel: el activo o, sin él, el más reciente de la empresa. */
export async function programaDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ProgramaVista | null> {
    const fila = await cliente
        .from('lealtad.programas as p')
        .where('p.empresa_id', empresaId)
        .orderBy('p.activo', 'desc')
        .orderBy('p.id', 'desc')
        .select(columnas(cliente))
        .first()
    return fila ? aVista(fila) : null
}

/** Programas de las empresas (null = todas), del más reciente al más antiguo. */
export async function listarProgramas(empresas: number[] | null): Promise<ProgramaVista[]> {
    const filas = await db
        .from('lealtad.programas as p')
        .if(empresas !== null, (q) => q.whereIn('p.empresa_id', empresas!))
        .orderBy('p.empresa_id', 'asc')
        .orderBy('p.id', 'desc')
        .select(columnas(db.connection()))
    return filas.map(aVista)
}

/** ¿La empresa tiene algún programa (activo o no)? Lo usa el consumidor para no evaluar en vano. */
export async function empresaConPrograma(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<boolean> {
    const fila = await cliente.from('lealtad.programas').where('empresa_id', empresaId).select('id').first()
    return Boolean(fila)
}

/** ¿El programa está vigente en la fecha (YYYY-MM-DD)? */
export function programaVigente(
    programa: Pick<ProgramaVista, 'activo' | 'vigente_desde' | 'vigente_hasta'>,
    fecha: string,
): boolean {
    return (
        programa.activo &&
        programa.vigente_desde <= fecha &&
        (programa.vigente_hasta === null || fecha <= programa.vigente_hasta)
    )
}

/** Campos auditables del programa (para `audit.cambios`). */
export function camposAuditables(programa: ProgramaVista): Record<string, unknown> {
    return Object.fromEntries(CAMPOS_PROGRAMA.map((c) => [c, programa[c]]))
}
