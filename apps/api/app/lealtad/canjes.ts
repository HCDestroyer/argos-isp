import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import type { TipoPremio } from '#lealtad/premios'

/**
 * Canjes de puntos (`contratos/lealtad.md` §3 y §5). El estado (`reservado`, `aplicado`, `revertido`,
 * `rechazado`) cambia solo por acción; los puntos salen con el movimiento `canje` (`movimiento_id`).
 */

export const ESTADOS_CANJE = ['reservado', 'aplicado', 'revertido', 'rechazado'] as const
export type EstadoCanje = (typeof ESTADOS_CANJE)[number]
export const CANALES_CANJE = ['panel', 'portal'] as const
export type CanalCanje = (typeof CANALES_CANJE)[number]

export interface CanjeVista {
    id: number
    empresa_id: number
    programa_id: number
    cliente_id: number
    servicio_id: number
    premio_id: number
    premio_nombre: string
    tipo: TipoPremio
    puntos: number
    estado: EstadoCanje
    /** Q del descuento (null hasta aplicarse, en un descuento reservado para la próxima factura) */
    descuento: string | null
    factura_id: number | null
    nota_credito_id: number | null
    plan_temporal_id: number | null
    movimiento_id: number | null
    canal: CanalCanje
    aplicado_en: Date | null
    revertido_en: Date | null
    motivo: string | null
    creado_por: number | null
    version: number
    created_at: Date
    updated_at: Date
}

export const CAMPOS_CANJE = [
    'estado',
    'descuento',
    'factura_id',
    'nota_credito_id',
    'plan_temporal_id',
    'movimiento_id',
    'aplicado_en',
    'revertido_en',
    'motivo',
] as const

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('lealtad.canjes as c')
        .join('lealtad.premios as p', 'p.id', 'c.premio_id')
        .select(
            'c.id',
            'c.empresa_id',
            'c.programa_id',
            'c.cliente_id',
            'c.servicio_id',
            'c.premio_id',
            'p.nombre as premio_nombre',
            'c.tipo',
            'c.puntos',
            'c.estado',
            'c.descuento',
            'c.factura_id',
            'c.nota_credito_id',
            'c.plan_temporal_id',
            'c.movimiento_id',
            'c.canal',
            'c.aplicado_en',
            'c.revertido_en',
            'c.motivo',
            'c.creado_por',
            'c.version',
            'c.created_at',
            'c.updated_at',
        )
}

function aVista(f: Record<string, any>): CanjeVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        programa_id: Number(f.programa_id),
        cliente_id: Number(f.cliente_id),
        servicio_id: Number(f.servicio_id),
        premio_id: Number(f.premio_id),
        puntos: Number(f.puntos),
        factura_id: n(f.factura_id),
        nota_credito_id: n(f.nota_credito_id),
        plan_temporal_id: n(f.plan_temporal_id),
        movimiento_id: n(f.movimiento_id),
        creado_por: n(f.creado_por),
        version: Number(f.version),
    } as CanjeVista
}

export async function verCanje(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<CanjeVista> {
    const q = consulta(cliente).where('c.id', id)
    if (bloquear) q.forUpdate('c')
    const fila = await q.first()
    if (!fila) throw new NoEncontrado(`El canje ${id} no existe`)
    return aVista(fila)
}

export interface FiltrosCanjes extends OpcionesPaginacion {
    cliente_id?: number
    servicio_id?: number
    estado?: EstadoCanje
}

export async function listarCanjes(empresas: number[] | null, filtros: FiltrosCanjes): Promise<Pagina<CanjeVista>> {
    const q = consulta(db.connection())
        .if(empresas !== null, (c) => c.whereIn('c.empresa_id', empresas!))
        .if(filtros.cliente_id !== undefined, (c) => c.where('c.cliente_id', filtros.cliente_id!))
        .if(filtros.servicio_id !== undefined, (c) => c.where('c.servicio_id', filtros.servicio_id!))
        .if(filtros.estado !== undefined, (c) => c.where('c.estado', filtros.estado!))
    const pagina = await paginar(q, filtros, { columna: 'c.id' })
    return { data: pagina.data.map(aVista), nextCursor: pagina.nextCursor }
}

/** Descuento reservado (sin aplicar) del servicio, o null: uno a la vez por servicio (§5, 409 `canje_pendiente`). */
export async function descuentoReservado(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<CanjeVista | null> {
    const fila = await consulta(cliente)
        .where('c.servicio_id', servicioId)
        .where('c.estado', 'reservado')
        .whereIn('c.tipo', ['descuento_factura', 'mes_gratis'])
        .first()
    return fila ? aVista(fila) : null
}

export function camposAuditables(c: CanjeVista): Record<string, unknown> {
    return Object.fromEntries(CAMPOS_CANJE.map((k) => [k, c[k]]))
}
