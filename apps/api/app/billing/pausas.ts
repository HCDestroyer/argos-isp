import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { ZONA_NEGOCIO } from '#ledger/fechas'

/**
 * Pausa sin cobro (decisión del PM 16): lectura y regla de periodos. Las acciones están en
 * `actions/pausar_sin_cobro.ts`, `actions/terminar_pausa.ts` y `actions/terminar_pausas.ts`.
 *
 * Un periodo **no se factura** si su inicio cae dentro de una pausa del servicio:
 * `desde ≤ inicio < fin efectivo`, con fin efectivo = el día (Guatemala) de `terminada_en` si terminó
 * antes, o `hasta`. La regla vale para pausas activas y terminadas: el cron de facturas procesa «todo
 * lo pendiente hasta ahora» y no debe emitir después los periodos que estuvieron en pausa.
 */

export const FINES_PAUSA = ['vencida', 'manual', 'reactivado', 'retirado'] as const
export type FinPausa = (typeof FINES_PAUSA)[number]

export interface PausaVista {
    id: number
    empresa_id: number
    servicio_id: number
    cliente_id: number
    desde: string
    hasta: string
    dias: number
    motivo: string
    estado: 'activa' | 'terminada'
    terminada_en: Date | null
    fin_motivo: FinPausa | null
    creada_por: number | null
    terminada_por: number | null
    version: number
    created_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('billing.pausas_servicio')
        .select(
            'id',
            'empresa_id',
            'servicio_id',
            'cliente_id',
            cliente.raw(`to_char(desde, 'YYYY-MM-DD') as desde`),
            cliente.raw(`to_char(hasta, 'YYYY-MM-DD') as hasta`),
            'dias',
            'motivo',
            'estado',
            'terminada_en',
            'fin_motivo',
            'creada_por',
            'terminada_por',
            'version',
            'created_at',
        )
}

function normalizar(f: PausaVista): PausaVista {
    const id = (v: number | null) => (v === null ? null : Number(v))
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        servicio_id: Number(f.servicio_id),
        cliente_id: Number(f.cliente_id),
        dias: Number(f.dias),
        creada_por: id(f.creada_por),
        terminada_por: id(f.terminada_por),
        version: Number(f.version),
    }
}

export async function verPausa(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PausaVista> {
    const fila = (await consulta(cliente).where('id', id).first()) as PausaVista | null
    if (!fila) throw new NoEncontrado(`La pausa ${id} no existe`)
    return normalizar(fila)
}

/** Pausas de un servicio, la más reciente primero. */
export async function pausasDeServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PausaVista[]> {
    const filas = (await consulta(cliente)
        .where('servicio_id', servicioId)
        .orderBy('id', 'desc')) as PausaVista[]
    return filas.map(normalizar)
}

/** Rangos `[desde, fin)` (YYYY-MM-DD) en que el servicio estuvo o está en pausa. */
export async function rangosSinCobro(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<Array<{ desde: string; fin: string }>> {
    const filas = (await cliente
        .from('billing.pausas_servicio')
        .where('servicio_id', servicioId)
        .select(
            cliente.raw(`to_char(desde, 'YYYY-MM-DD') as desde`),
            cliente.raw(
                `to_char(CASE WHEN terminada_en IS NULL THEN hasta
                    ELSE least(hasta, (terminada_en AT TIME ZONE '${ZONA_NEGOCIO}')::date) END, 'YYYY-MM-DD') as fin`,
            ),
        )) as Array<{ desde: string; fin: string }>
    return filas
}

/** ¿El periodo que empieza en `inicio` cae en una pausa? */
export function enPausa(rangos: Array<{ desde: string; fin: string }>, inicio: string): boolean {
    return rangos.some((r) => r.desde <= inicio && inicio < r.fin)
}

/** Día de Guatemala `n` días después de `fecha` (YYYY-MM-DD). */
export function masDias(fecha: string, n: number): string {
    return DateTime.fromISO(fecha, { zone: ZONA_NEGOCIO }).plus({ days: n }).toISODate()!
}
