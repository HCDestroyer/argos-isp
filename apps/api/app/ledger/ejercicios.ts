import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { CERO, dec, type Dec } from '#ledger/dinero'

/**
 * Ejercicios (cierre anual, contrato de localización fiscal §9.1 y §10.8): lectura y ayudas.
 *
 * Un ejercicio está cerrado si tiene un cierre sin reapertura (`ledger.ejercicio_cerrado(fecha,
 * empresa)`, la misma función que usa el trigger de `cierres_anuales`). Los asientos del cierre
 * llevan `origen_tipo = 'cierre_anual'` y `origen_id` = el cierre; sus reversos (al reabrir), el
 * mismo origen.
 */

export interface CierreAnualVista {
    id: number
    empresa_id: number
    anio: number
    estado: 'cerrado' | 'reabierto'
    isr: string
    isr_acreditado_trimestral: string
    isr_acreditado_iso: string
    isr_nota: string | null
    resultado_antes_isr: string
    resultado: string
    reserva_legal: string
    resumen: unknown
    asientos: number[]
    cerrado_en: Date
    cerrado_por: number | null
    cerrado_por_nombre: string | null
    reabierto_en: Date | null
    reabierto_por: number | null
    reabierto_por_nombre: string | null
    motivo_reapertura: string | null
}

/** Año válido del ejercicio (422 si no lo es). */
export function anioValido(anio: number): number {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        throw new ValidacionFallida([{ field: 'anio', message: 'Año inválido', rule: 'anio' }])
    }
    return anio
}

/** ¿El ejercicio del año de `fecha` está cerrado en la empresa? (misma función que el trigger) */
export async function ejercicioCerrado(cliente: QueryClientContract, fecha: string, empresaId: number) {
    const r = await cliente.rawQuery('SELECT ledger.ejercicio_cerrado(?::date, ?) AS cerrado', [
        fecha,
        empresaId,
    ])
    return Boolean((r.rows[0] as { cerrado: boolean }).cerrado)
}

/** Cierre vigente (sin reapertura) del año, o null. */
export async function cierreVigente(cliente: QueryClientContract, empresaId: number, anio: number) {
    const fila = (await cliente
        .from('ledger.cierres_anuales as c')
        .where('c.empresa_id', empresaId)
        .where('c.anio', anio)
        .whereNotExists((q) => q.from('ledger.reaperturas_anuales as r').whereRaw('r.cierre_id = c.id'))
        .select('c.id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

export interface SaldoResultado {
    cuenta_id: number
    codigo: string
    nombre: string
    tipo: 'ingreso' | 'gasto'
    /** debe − haber del año (sin los asientos de cierre anual) */
    neto: Dec
}

/**
 * Saldos del año de las cuentas que se reinician (`reinicia_anual`: ingresos y gastos), sin los
 * asientos `cierre_anual` (ni sus reversos): lo que el cierre cancela.
 */
export async function saldosDeResultados(
    cliente: QueryClientContract,
    empresaId: number,
    anio: number,
): Promise<SaldoResultado[]> {
    const filas = (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .whereBetween('a.fecha', [`${anio}-01-01`, `${anio}-12-31`])
        .whereNot('a.origen_tipo', 'cierre_anual')
        .where('c.reinicia_anual', true)
        .groupBy('c.id', 'c.codigo', 'c.nombre', 'c.tipo')
        .orderBy('c.codigo', 'asc')
        .select(
            'c.id as cuenta_id',
            'c.codigo',
            'c.nombre',
            'c.tipo',
            cliente.raw('sum(m.debe - m.haber)::text as neto'),
        )) as Array<{
        cuenta_id: number
        codigo: string
        nombre: string
        tipo: 'ingreso' | 'gasto'
        neto: string
    }>
    return filas.map((f) => ({ ...f, cuenta_id: Number(f.cuenta_id), neto: dec(f.neto) }))
}

/** Saldo deudor (debe − haber) de una cuenta de la empresa al `hasta`. */
export async function saldoDeudor(
    cliente: QueryClientContract,
    empresaId: number,
    codigo: string,
    hasta: string,
): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('c.codigo', codigo)
        .where('a.fecha', '<=', hasta)
        .select(cliente.raw('coalesce(sum(m.debe - m.haber), 0)::text as saldo'))
        .first()) as { saldo: string } | null
    return fila ? dec(fila.saldo) : CERO
}

function consultaCierres(cliente: QueryClientContract) {
    return cliente
        .from('ledger.cierres_anuales as c')
        .leftJoin('ledger.reaperturas_anuales as r', 'r.cierre_id', 'c.id')
        .leftJoin('core.usuarios as uc', 'uc.id', 'c.cerrado_por')
        .leftJoin('core.usuarios as ur', 'ur.id', 'r.reabierto_por')
        .select(
            'c.id',
            'c.empresa_id',
            'c.anio',
            cliente.raw(`case when r.id is null then 'cerrado' else 'reabierto' end as estado`),
            cliente.raw('c.isr::text as isr'),
            cliente.raw('c.isr_acreditado_trimestral::text as isr_acreditado_trimestral'),
            cliente.raw('c.isr_acreditado_iso::text as isr_acreditado_iso'),
            'c.isr_nota',
            cliente.raw('c.resultado_antes_isr::text as resultado_antes_isr'),
            cliente.raw('c.resultado::text as resultado'),
            cliente.raw('c.reserva_legal::text as reserva_legal'),
            'c.resumen',
            cliente.raw(
                `coalesce((SELECT array_agg(a.id ORDER BY a.id) FROM ledger.asientos a
                            WHERE a.origen_tipo = 'cierre_anual' AND a.origen_id = c.id), '{}') as asientos`,
            ),
            'c.cerrado_en',
            'c.cerrado_por',
            'uc.nombre as cerrado_por_nombre',
            'r.reabierto_en',
            'r.reabierto_por',
            'ur.nombre as reabierto_por_nombre',
            'r.motivo as motivo_reapertura',
        )
}

function normalizar(fila: CierreAnualVista): CierreAnualVista {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        anio: Number(fila.anio),
        asientos: (fila.asientos ?? []).map(Number),
    }
}

export async function verCierreAnual(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaCierres(cliente).where('c.id', id).first()) as CierreAnualVista | null
    if (!fila) throw new NoEncontrado(`El cierre anual ${id} no existe`)
    return normalizar(fila)
}

/** Historia de cierres anuales y reaperturas, el más reciente primero. */
export async function listarCierresAnuales(
    filtros: OpcionesPaginacion & { estado?: 'cerrado' | 'reabierto'; anio?: number },
    empresas: number[] | null = null,
) {
    const consulta = consultaCierres(db.connection())
        .if(filtros.estado === 'cerrado', (q) => q.whereNull('r.id'))
        .if(filtros.estado === 'reabierto', (q) => q.whereNotNull('r.id'))
        .if(filtros.anio !== undefined, (q) => q.where('c.anio', filtros.anio!))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('c.empresa_id', ids))
    const pagina = await paginar<CierreAnualVista>(consulta, filtros, { columna: 'c.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}
