import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa, filtrarPorEmpresa } from '#shared/empresa_activa'
import type { Transaccion } from '#shared/domain_action'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Borradores de asiento manual (decisión del PM 10): el asiento que espera que **otro** usuario lo
 * apruebe cuando la empresa tiene `asientos_requieren_aprobacion`. No toca el libro. Tablas de solo
 * inserción `billing.asientos_borradores` y `billing.asientos_borradores_decisiones`; el estado se
 * deriva de la decisión (sin decisión = `pendiente`).
 */

export const ESTADOS_BORRADOR = ['pendiente', 'aprobado', 'rechazado'] as const
export type EstadoBorrador = (typeof ESTADOS_BORRADOR)[number]

export interface MovimientoBorrador {
    cuenta: string
    debe: string
    haber: string
    cliente_id: number | null
    proveedor_id: number | null
}

export interface BorradorAsientoVista {
    id: number
    empresa_id: number
    fecha: string | null
    descripcion: string
    movimientos: MovimientoBorrador[]
    total: string
    estado: EstadoBorrador
    creado_por: number | null
    creado_por_nombre: string | null
    created_at: Date
    decidido_por: number | null
    decidido_por_nombre: string | null
    decidido_en: Date | null
    motivo_rechazo: string | null
    asiento_id: number | null
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('billing.asientos_borradores as b')
        .leftJoin('billing.asientos_borradores_decisiones as d', 'd.borrador_id', 'b.id')
        .leftJoin('core.usuarios as uc', 'uc.id', 'b.creado_por')
        .leftJoin('core.usuarios as ud', 'ud.id', 'd.decidido_por')
        .select(
            'b.id',
            'b.empresa_id',
            cliente.raw(`to_char(b.fecha, 'YYYY-MM-DD') as fecha`),
            'b.descripcion',
            'b.movimientos',
            'b.total',
            cliente.raw(`coalesce(d.decision, 'pendiente') as estado`),
            'b.creado_por',
            'uc.nombre as creado_por_nombre',
            'b.created_at',
            'd.decidido_por',
            'ud.nombre as decidido_por_nombre',
            'd.created_at as decidido_en',
            cliente.raw(`CASE WHEN d.decision = 'rechazado' THEN d.motivo END as motivo_rechazo`),
            'd.asiento_id',
        )
}

function normalizar(f: BorradorAsientoVista): BorradorAsientoVista {
    const id = (v: number | null) => (v === null ? null : Number(v))
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        creado_por: id(f.creado_por),
        decidido_por: id(f.decidido_por),
        asiento_id: id(f.asiento_id),
    }
}

export async function verBorrador(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<BorradorAsientoVista> {
    const fila = (await consulta(cliente).where('b.id', id).first()) as BorradorAsientoVista | null
    if (!fila) throw new NoEncontrado(`El borrador de asiento ${id} no existe`)
    return normalizar(fila)
}

export async function listarBorradores(
    filtros: OpcionesPaginacion & { estado?: EstadoBorrador | null },
    empresas: number[] | null,
): Promise<Pagina<BorradorAsientoVista>> {
    const q = consulta(db.connection()).if(filtros.estado, (r) =>
        filtros.estado === 'pendiente' ? r.whereNull('d.decision') : r.where('d.decision', filtros.estado!),
    )
    filtrarPorEmpresa(q, empresas, (r, ids) => r.whereIn('b.empresa_id', ids))
    const pagina = await paginar<BorradorAsientoVista>(q, filtros, { columna: 'b.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}

export interface FilaBorrador {
    id: number
    empresa_id: number
    fecha: string | null
    descripcion: string
    movimientos: MovimientoBorrador[]
    total: string
    creado_por: number | null
}

/** Bloquea un borrador pendiente (409 `borrador_decidido` si ya se decidió). */
export async function bloquearBorrador(t: Transaccion, id: number): Promise<FilaBorrador> {
    t.fijarEntidad('asiento_borrador', id)
    // sin FOR UPDATE: la tabla es de solo inserción (la app no tiene UPDATE); la PK de la decisión
    // impide además decidir dos veces
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3022, ?::int)', [id])
    const fila = (await t.trx
        .from('billing.asientos_borradores')
        .where('id', id)
        .select(
            'id',
            'empresa_id',
            t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
            'descripcion',
            'movimientos',
            'total',
            'creado_por',
        )
        .first()) as FilaBorrador | null
    if (!fila) throw new NoEncontrado(`El borrador de asiento ${id} no existe`)
    const empresaId = Number(fila.empresa_id)
    exigirAccesoEmpresa(t.ctx, empresaId)
    t.fijarEmpresa(empresaId)
    const decision = (await t.trx
        .from('billing.asientos_borradores_decisiones')
        .where('borrador_id', id)
        .select('decision')
        .first()) as { decision: string } | null
    if (decision) {
        throw new Conflicto(
            `El borrador ${id} ya fue ${decision.decision}`,
            'borrador_decidido',
            'Borrador ya decidido',
        )
    }
    return {
        ...fila,
        empresa_id: empresaId,
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
    }
}
