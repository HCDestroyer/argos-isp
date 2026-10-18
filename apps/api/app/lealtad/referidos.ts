import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Referidos (`contratos/lealtad.md` §3, §4 y §9). El código y quién refirió a quién son de A1
 * (`core.codigos_referido`, `core.clientes.referido_por_id` / `referido_empresa_id`, capturados en
 * el alta del cliente); aquí vive el seguimiento del programa: `lealtad.referidos`, uno por
 * cliente referido y empresa, que se registra al consumir `servicio.creado` del referido en la
 * empresa del código y se califica cuando paga las facturas mínimas de la regla.
 */

export const ESTADOS_REFERIDO = ['pendiente', 'calificado', 'rechazado'] as const
export type EstadoReferido = (typeof ESTADOS_REFERIDO)[number]

export interface ReferidoVista {
    id: number
    empresa_id: number
    referidor_id: number
    referidor_nombre: string
    referido_id: number
    referido_nombre: string
    codigo: string
    estado: EstadoReferido
    calificado_en: Date | null
    motivo: string | null
    version: number
    created_at: Date
    updated_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('lealtad.referidos as r')
        .join('core.clientes as a', 'a.id', 'r.referidor_id')
        .join('core.clientes as b', 'b.id', 'r.referido_id')
        .select(
            'r.id',
            'r.empresa_id',
            'r.referidor_id',
            'a.nombre as referidor_nombre',
            'r.referido_id',
            'b.nombre as referido_nombre',
            'r.codigo',
            'r.estado',
            'r.calificado_en',
            'r.motivo',
            'r.version',
            'r.created_at',
            'r.updated_at',
        )
}

function aVista(fila: Record<string, any>): ReferidoVista {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        referidor_id: Number(fila.referidor_id),
        referido_id: Number(fila.referido_id),
        version: Number(fila.version),
    } as ReferidoVista
}

export async function verReferido(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<ReferidoVista> {
    const q = consulta(cliente).where('r.id', id)
    if (bloquear) q.forUpdate('r')
    const fila = await q.first()
    if (!fila) throw new NoEncontrado(`El referido ${id} no existe`)
    return aVista(fila)
}

/** Referido (pendiente o calificado) del cliente en la empresa, o null. */
export async function referidoEnEmpresa(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<ReferidoVista | null> {
    const fila = await consulta(cliente)
        .where('r.empresa_id', empresaId)
        .where('r.referido_id', clienteId)
        .first()
    return fila ? aVista(fila) : null
}

export interface FiltrosReferidos extends OpcionesPaginacion {
    estado?: EstadoReferido
    referidor_id?: number
    referido_id?: number
}

export async function listarReferidos(
    empresas: number[] | null,
    filtros: FiltrosReferidos,
): Promise<Pagina<ReferidoVista>> {
    const q = consulta(db.connection())
        .if(empresas !== null, (c) => c.whereIn('r.empresa_id', empresas!))
        .if(filtros.estado !== undefined, (c) => c.where('r.estado', filtros.estado!))
        .if(filtros.referidor_id !== undefined, (c) => c.where('r.referidor_id', filtros.referidor_id!))
        .if(filtros.referido_id !== undefined, (c) => c.where('r.referido_id', filtros.referido_id!))
    const pagina = await paginar(q, filtros, { columna: 'r.id' })
    return { data: pagina.data.map(aVista), nextCursor: pagina.nextCursor }
}

export function camposAuditables(r: ReferidoVista): Record<string, unknown> {
    return { estado: r.estado, calificado_en: r.calificado_en, motivo: r.motivo }
}
