import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import type { OrigenBonificacion } from '#billing/bonificaciones'
import { marcaDeEmpresa, marcasDeEmpresas, type MarcaEmpresa } from '#portal/marca'

/**
 * Bonificaciones en el portal (decisión del PM, 19 oct; README de billing «Bonificaciones»): un
 * periodo que quedó en cero (mes gratis, descuento del 100 %, canje, cargo sin costo) ya no es una
 * factura de Q0 sino una fila de `billing.bonificaciones` (A3). El cliente la ve como «Mes
 * bonificado: <concepto>», sin monto a pagar ni documento.
 *
 * Lectura propia, filtrada por el cliente de la sesión. Nunca sale el motivo interno (`motivo_id`,
 * `motivo_texto`), ni montos, líneas, asiento o canje: no hay nada que pagar ni descargar.
 */

export interface BonificacionPortal {
    id: number
    empresa: MarcaEmpresa
    servicio_id: number | null
    periodo: string
    concepto: string
    origen: OrigenBonificacion
    created_at: string
}

/** Meses que el inicio muestra en el estado de cuenta de cada empresa (el actual y dos atrás). */
export const MESES_RECIENTES = 3

/** «Servicio de internet Hogar · periodo 2026-11-01» → «Servicio de internet Hogar»: el periodo va aparte. */
function conceptoParaCliente(concepto: string): string {
    return concepto.replace(/\s*·\s*periodo \d{4}-\d{2}-\d{2}$/, '').trim() || concepto
}

type Fila = {
    id: number
    empresa_id: number
    servicio_id: number | null
    periodo: string
    concepto: string
    origen: OrigenBonificacion
    created_at: Date | string
}

function consulta(clienteId: number) {
    return db
        .from('billing.bonificaciones as b')
        .where('b.cliente_id', clienteId)
        .select(
            'b.id',
            'b.empresa_id',
            'b.servicio_id',
            db.raw(`to_char(b.periodo, 'YYYY-MM-DD') as periodo`),
            'b.concepto',
            'b.origen',
            'b.created_at',
        )
}

async function aVistas(filas: Fila[]): Promise<BonificacionPortal[]> {
    const marcas = await marcasDeEmpresas(filas.map((f) => Number(f.empresa_id)))
    const salida: BonificacionPortal[] = []
    for (const f of filas) {
        const empresaId = Number(f.empresa_id)
        salida.push({
            id: Number(f.id),
            empresa: marcas.get(empresaId) ?? (await marcaDeEmpresa(empresaId)),
            servicio_id: f.servicio_id === null ? null : Number(f.servicio_id),
            periodo: f.periodo,
            concepto: conceptoParaCliente(f.concepto),
            origen: f.origen,
            created_at: f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at),
        })
    }
    return salida
}

/** `GET /portal/bonificaciones`: las del cliente de la sesión, de la más reciente a la más antigua. */
export async function bonificacionesPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<BonificacionPortal>> {
    const pagina = await paginar<Fila>(consulta(clienteId), opciones, { columna: 'b.id' })
    return { data: await aVistas(pagina.data), nextCursor: pagina.nextCursor }
}

/**
 * Bonificaciones recientes del cliente por empresa (periodo desde el primer día de hace
 * `MESES_RECIENTES - 1` meses en Guatemala), para el estado de cuenta de `GET /portal/cuenta`.
 */
export async function bonificacionesRecientes(clienteId: number): Promise<Map<number, BonificacionPortal[]>> {
    const filas = (await consulta(clienteId)
        .whereRaw(
            `b.periodo >= date_trunc('month', (now() AT TIME ZONE 'America/Guatemala')) - make_interval(months => ?)`,
            [MESES_RECIENTES - 1],
        )
        .orderBy('b.periodo', 'desc')
        .orderBy('b.id', 'desc')) as Fila[]
    const porEmpresa = new Map<number, BonificacionPortal[]>()
    for (const vista of await aVistas(filas)) {
        porEmpresa.set(vista.empresa.id, [...(porEmpresa.get(vista.empresa.id) ?? []), vista])
    }
    return porEmpresa
}
