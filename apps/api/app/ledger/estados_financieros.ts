import db from '@adonisjs/lucid/services/db'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { saldoSegunNaturaleza } from '#ledger/consultas'
import { resumenEmpresas } from '#billing/empresa'

/**
 * Balance de saldos y estado de resultados **por empresa** (multiempresa: cada NIT tiene su
 * libro). El catálogo de cuentas es común; los saldos salen de los asientos de cada empresa.
 *
 * Con varias empresas (consolidado, `?empresas=todas` con alcance global) la respuesta trae una
 * sección por empresa y `total`, la suma del grupo. Con una, una sola sección igual a `total`.
 */

interface FilaSaldo {
    empresa_id: number
    cuenta_id: number
    codigo: string
    nombre: string
    tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto'
    naturaleza: 'deudora' | 'acreedora'
    debe: string
    haber: string
}

export interface LineaEstado {
    cuenta_id: number
    codigo: string
    nombre: string
    tipo: FilaSaldo['tipo']
    naturaleza: FilaSaldo['naturaleza']
    debe: string
    haber: string
    /** según la naturaleza: deudora (activo, gasto) o acreedora (pasivo, patrimonio, ingreso; al revés en las contracuentas) */
    saldo: string
}

export interface TotalesBalance {
    debe: string
    haber: string
    activo: string
    pasivo: string
    /** patrimonio (capital, reservas, resultados acumulados) */
    patrimonio: string
    ingresos: string
    gastos: string
    /** ingresos − gastos */
    resultado: string
    /** debe = haber y activo = pasivo + patrimonio + resultado */
    cuadra: boolean
}

export interface TotalesResultados {
    ingresos: string
    gastos: string
    resultado: string
}

export interface SeccionEmpresa<T> {
    empresa_id: number | null
    nombre_comercial: string | null
    nit: string | null
    cuentas: LineaEstado[]
    totales: T
}

async function saldosPorCuenta(
    empresas: number[] | null,
    rango: { desde?: string; hasta: string },
    tipos?: Array<FilaSaldo['tipo']>,
): Promise<FilaSaldo[]> {
    return (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.fecha', '<=', rango.hasta)
        .if(rango.desde, (q) => q.where('a.fecha', '>=', rango.desde!))
        .if(empresas !== null, (q) => q.whereIn('a.empresa_id', empresas!))
        .if(tipos, (q) => q.whereIn('c.tipo', tipos!))
        .groupBy('a.empresa_id', 'c.id', 'c.codigo', 'c.nombre', 'c.tipo', 'c.naturaleza')
        .orderBy([
            { column: 'a.empresa_id', order: 'asc' },
            { column: 'c.codigo', order: 'asc' },
        ])
        .select(
            'a.empresa_id',
            'c.id as cuenta_id',
            'c.codigo',
            'c.nombre',
            'c.tipo',
            'c.naturaleza',
            db.raw('sum(m.debe)::text as debe'),
            db.raw('sum(m.haber)::text as haber'),
        )) as FilaSaldo[]
}

function lineas(filas: FilaSaldo[]): LineaEstado[] {
    const porCuenta = new Map<number, { fila: FilaSaldo; debe: Dec; haber: Dec }>()
    for (const fila of filas) {
        const actual = porCuenta.get(fila.cuenta_id) ?? { fila, debe: CERO, haber: CERO }
        actual.debe = actual.debe.plus(dec(fila.debe))
        actual.haber = actual.haber.plus(dec(fila.haber))
        porCuenta.set(fila.cuenta_id, actual)
    }
    return [...porCuenta.values()]
        .sort((a, b) => a.fila.codigo.localeCompare(b.fila.codigo))
        .map(({ fila, debe, haber }) => ({
            cuenta_id: Number(fila.cuenta_id),
            codigo: fila.codigo,
            nombre: fila.nombre,
            tipo: fila.tipo,
            naturaleza: fila.naturaleza,
            debe: aTexto(debe),
            haber: aTexto(haber),
            saldo: aTexto(saldoSegunNaturaleza(fila.naturaleza, debe, haber)),
        }))
}

/**
 * Total de un tipo en su lado normal (deudor en activo y gasto, acreedor en los demás). Las
 * contracuentas restan: la depreciación acumulada baja el activo, los ingresos diferidos bajan los
 * ingresos.
 */
function sumaPorTipo(cuentas: LineaEstado[], tipo: FilaSaldo['tipo']): Dec {
    const deudor = tipo === 'activo' || tipo === 'gasto'
    return cuentas
        .filter((c) => c.tipo === tipo)
        .reduce((suma, c) => {
            const neto = dec(c.debe).minus(dec(c.haber))
            return suma.plus(deudor ? neto : neto.negated())
        }, CERO)
}

function totalesBalance(cuentas: LineaEstado[]): TotalesBalance {
    const debe = cuentas.reduce((s, c) => s.plus(dec(c.debe)), CERO)
    const haber = cuentas.reduce((s, c) => s.plus(dec(c.haber)), CERO)
    const activo = sumaPorTipo(cuentas, 'activo')
    const pasivo = sumaPorTipo(cuentas, 'pasivo')
    const patrimonio = sumaPorTipo(cuentas, 'patrimonio')
    const ingresos = sumaPorTipo(cuentas, 'ingreso')
    const gastos = sumaPorTipo(cuentas, 'gasto')
    const resultado = ingresos.minus(gastos)
    return {
        debe: aTexto(debe),
        haber: aTexto(haber),
        activo: aTexto(activo),
        pasivo: aTexto(pasivo),
        patrimonio: aTexto(patrimonio),
        ingresos: aTexto(ingresos),
        gastos: aTexto(gastos),
        resultado: aTexto(resultado),
        cuadra: debe.equals(haber) && activo.equals(pasivo.plus(patrimonio).plus(resultado)),
    }
}

function totalesResultados(cuentas: LineaEstado[]): TotalesResultados {
    const ingresos = sumaPorTipo(cuentas, 'ingreso')
    const gastos = sumaPorTipo(cuentas, 'gasto')
    return { ingresos: aTexto(ingresos), gastos: aTexto(gastos), resultado: aTexto(ingresos.minus(gastos)) }
}

async function secciones<T>(
    empresas: number[] | null,
    filas: FilaSaldo[],
    totales: (cuentas: LineaEstado[]) => T,
): Promise<{ empresas: Array<SeccionEmpresa<T>>; total: { cuentas: LineaEstado[]; totales: T } }> {
    const ids = [...new Set([...(empresas ?? []), ...filas.map((f) => Number(f.empresa_id))])].sort(
        (a, b) => a - b,
    )
    const datos = await resumenEmpresas(ids)
    const porEmpresa = ids.map((id) => {
        const cuentas = lineas(filas.filter((f) => Number(f.empresa_id) === id))
        const empresa = datos.get(id)
        return {
            empresa_id: id,
            nombre_comercial: empresa?.nombre_comercial ?? null,
            nit: empresa?.nit ?? null,
            cuentas,
            totales: totales(cuentas),
        }
    })
    const cuentas = lineas(filas)
    return { empresas: porEmpresa, total: { cuentas, totales: totales(cuentas) } }
}

/** Balance de saldos al `hasta` (por defecto hoy): saldo de cada cuenta con movimiento. */
export async function balanceSaldos(filtros: { hasta?: string }, empresas: number[] | null) {
    const hasta = filtros.hasta ?? hoyGuatemala()
    const filas = await saldosPorCuenta(empresas, { hasta })
    return { hasta, consolidado: empresas === null, ...(await secciones(empresas, filas, totalesBalance)) }
}

/** Estado de resultados del rango: ingresos y gastos por cuenta y el resultado. */
export async function estadoResultados(
    filtros: { desde?: string; hasta?: string },
    empresas: number[] | null,
) {
    const hasta = filtros.hasta ?? hoyGuatemala()
    const desde = filtros.desde ?? `${hasta.slice(0, 7)}-01`
    const filas = await saldosPorCuenta(empresas, { desde, hasta }, ['ingreso', 'gasto'])
    return {
        desde,
        hasta,
        consolidado: empresas === null,
        ...(await secciones(empresas, filas, totalesResultados)),
    }
}
