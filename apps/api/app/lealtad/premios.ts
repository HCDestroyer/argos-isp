import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Catálogo de premios del programa (`contratos/lealtad.md` §3 y §5). Cada premio es de la empresa
 * de su programa; se edita con `version` y se desactiva (no se borra: los canjes lo referencian).
 */

export const TIPOS_PREMIO = ['descuento_factura', 'mes_gratis', 'mejora_plan', 'bien', 'boletos'] as const
export type TipoPremio = (typeof TIPOS_PREMIO)[number]

export const TIPOS_DESCUENTO = ['monto', 'porcentaje'] as const
export type TipoDescuento = (typeof TIPOS_DESCUENTO)[number]

export interface PremioVista {
    id: number
    empresa_id: number
    programa_id: number
    tipo: TipoPremio
    nombre: string
    costo_puntos: number
    descuento_tipo: TipoDescuento | null
    descuento_valor: string | null
    tope: string | null
    plan_destino_id: number | null
    dias: number | null
    costo_unitario: string | null
    existencias: number | null
    en_portal: boolean
    activo: boolean
    version: number
    created_at: Date
    updated_at: Date
}

export const CAMPOS_PREMIO = [
    'nombre',
    'costo_puntos',
    'descuento_tipo',
    'descuento_valor',
    'tope',
    'plan_destino_id',
    'dias',
    'costo_unitario',
    'existencias',
    'en_portal',
    'activo',
] as const

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function aVista(f: Record<string, any>): PremioVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        programa_id: Number(f.programa_id),
        costo_puntos: Number(f.costo_puntos),
        plan_destino_id: n(f.plan_destino_id),
        dias: n(f.dias),
        existencias: n(f.existencias),
        version: Number(f.version),
    } as PremioVista
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'programa_id',
    'tipo',
    'nombre',
    'costo_puntos',
    'descuento_tipo',
    'descuento_valor',
    'tope',
    'plan_destino_id',
    'dias',
    'costo_unitario',
    'existencias',
    'en_portal',
    'activo',
    'version',
    'created_at',
    'updated_at',
]

export async function verPremio(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<PremioVista> {
    const q = cliente.from('lealtad.premios').where('id', id).select(COLUMNAS)
    if (bloquear) q.forUpdate()
    const fila = await q.first()
    if (!fila) throw new NoEncontrado(`El premio ${id} no existe`)
    return aVista(fila)
}

export interface FiltrosPremios extends OpcionesPaginacion {
    programa_id?: number
    tipo?: TipoPremio
    activo?: boolean
    en_portal?: boolean
}

export async function listarPremios(
    empresas: number[] | null,
    filtros: FiltrosPremios,
): Promise<Pagina<PremioVista>> {
    const q = db
        .from('lealtad.premios')
        .if(empresas !== null, (c) => c.whereIn('empresa_id', empresas!))
        .if(filtros.programa_id !== undefined, (c) => c.where('programa_id', filtros.programa_id!))
        .if(filtros.tipo !== undefined, (c) => c.where('tipo', filtros.tipo!))
        .if(filtros.activo !== undefined, (c) => c.where('activo', filtros.activo!))
        .if(filtros.en_portal !== undefined, (c) => c.where('en_portal', filtros.en_portal!))
        .select(COLUMNAS)
    const pagina = await paginar(q, filtros)
    return { data: pagina.data.map(aVista), nextCursor: pagina.nextCursor }
}

export function camposAuditables(p: PremioVista): Record<string, unknown> {
    return Object.fromEntries(CAMPOS_PREMIO.map((c) => [c, p[c]]))
}
