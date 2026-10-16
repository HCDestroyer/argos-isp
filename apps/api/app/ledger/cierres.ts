import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'

/**
 * Cierres mensuales del libro: lectura y ayudas. Un mes está cerrado si tiene un cierre sin
 * reapertura (`ledger.periodo_cerrado(fecha)`, la misma función que usan los triggers).
 */

export interface CierreVista {
    id: number
    periodo: string
    estado: 'cerrado' | 'reabierto'
    cerrado_en: Date
    cerrado_por: number | null
    cerrado_por_nombre: string | null
    resumen: unknown
    reabierto_en: Date | null
    reabierto_por: number | null
    reabierto_por_nombre: string | null
    motivo_reapertura: string | null
}

/** Primer día del mes `anio-mes` (422 si no es un mes válido). */
export function periodoDe(anio: number, mes: number): string {
    const fecha = DateTime.fromObject({ year: anio, month: mes, day: 1 }, { zone: 'utc' })
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || !fecha.isValid || anio < 2000 || anio > 2100) {
        throw new ValidacionFallida([{ field: 'mes', message: 'Año o mes inválido', rule: 'periodo' }])
    }
    return fecha.toISODate()!
}

export async function periodoCerrado(cliente: QueryClientContract, fecha: string): Promise<boolean> {
    const resultado = await cliente.rawQuery('SELECT ledger.periodo_cerrado(?::date) AS cerrado', [fecha])
    return Boolean((resultado.rows[0] as { cerrado: boolean }).cerrado)
}

function consultaCierres(cliente: QueryClientContract) {
    return cliente
        .from('ledger.cierres_mensuales as c')
        .leftJoin('ledger.reaperturas_mensuales as r', 'r.cierre_id', 'c.id')
        .leftJoin('core.usuarios as uc', 'uc.id', 'c.cerrado_por')
        .leftJoin('core.usuarios as ur', 'ur.id', 'r.reabierto_por')
        .select(
            'c.id',
            cliente.raw(`to_char(c.periodo, 'YYYY-MM') as periodo`),
            cliente.raw(`case when r.id is null then 'cerrado' else 'reabierto' end as estado`),
            'c.cerrado_en',
            'c.cerrado_por',
            'uc.nombre as cerrado_por_nombre',
            'c.resumen',
            'r.reabierto_en',
            'r.reabierto_por',
            'ur.nombre as reabierto_por_nombre',
            'r.motivo as motivo_reapertura',
        )
}

export async function verCierre(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaCierres(cliente).where('c.id', id).first()) as CierreVista | null
    if (!fila) throw new NoEncontrado(`El cierre ${id} no existe`)
    return fila
}

/** Historia de cierres y reaperturas, la más reciente primero. */
export async function listarCierres(filtros: OpcionesPaginacion & { estado?: 'cerrado' | 'reabierto' }) {
    const consulta = consultaCierres(db.connection())
        .if(filtros.estado === 'cerrado', (q) => q.whereNull('r.id'))
        .if(filtros.estado === 'reabierto', (q) => q.whereNotNull('r.id'))
    return paginar<CierreVista>(consulta, filtros, { columna: 'c.id' })
}

/** Resumen del mes al cerrarlo: asientos, totales y movimiento por cuenta. */
export async function resumenDelMes(cliente: QueryClientContract, periodo: string) {
    const fin = DateTime.fromISO(periodo, { zone: 'utc' }).endOf('month').toISODate()!
    const totales = (await cliente
        .from('ledger.asientos as a')
        .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
        .whereBetween('a.fecha', [periodo, fin])
        .select(
            cliente.raw('count(distinct a.id)::int as asientos'),
            cliente.raw('coalesce(sum(m.debe), 0)::text as debe'),
            cliente.raw('coalesce(sum(m.haber), 0)::text as haber'),
        )
        .first()) as { asientos: number; debe: string; haber: string }
    const cuentas = await cliente
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .whereBetween('a.fecha', [periodo, fin])
        .groupBy('c.codigo', 'c.nombre')
        .orderBy('c.codigo', 'asc')
        .select(
            'c.codigo',
            'c.nombre',
            cliente.raw('sum(m.debe)::text as debe'),
            cliente.raw('sum(m.haber)::text as haber'),
        )
    return { desde: periodo, hasta: fin, ...totales, cuentas }
}
