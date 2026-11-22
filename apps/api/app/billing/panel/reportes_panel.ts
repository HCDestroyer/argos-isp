import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { hoyGuatemala } from '#ledger/fechas'
import {
    armarReporte,
    definirColumnas,
    porcentaje,
    type Fila,
    type Reporte,
} from '#billing/reportes/definicion'
import type { EmpresasReporte } from '#billing/reportes/reportes'
import {
    bajasPorMes,
    efectivoDisponible,
    efectivoVacio,
    ingresoRecurrente,
    ingresoVacio,
    mesesEntre,
} from '#billing/panel/indicadores'

/**
 * Reportes del panel financiero (`contratos/reportes.md` §2.4), con la forma común de los reportes:
 * se exportan a CSV, Excel y PDF y se pueden programar. Los títulos de columna llevan el término
 * técnico entre paréntesis (decisión 11 del PM): así queda también en la columna exportada.
 */

export const COLUMNAS_BAJAS = definirColumnas([
    { clave: 'periodo', titulo: 'Mes', tipo: 'texto' },
    { clave: 'altas', titulo: 'Altas', tipo: 'entero' },
    { clave: 'bajas', titulo: 'Bajas', tipo: 'entero' },
    { clave: 'retiros', titulo: 'Bajas por retiro', tipo: 'entero' },
    { clave: 'suspendidos', titulo: 'Bajas por suspensión larga', tipo: 'entero' },
    { clave: 'base', titulo: 'Servicios al inicio del mes', tipo: 'entero' },
    { clave: 'tasa', titulo: 'Tasa de bajas (churn) %', tipo: 'porcentaje', nulable: true },
    { clave: 'dias_baja', titulo: 'Días de suspensión para baja', tipo: 'entero' },
])

export const COLUMNAS_INDICADORES = definirColumnas([
    { clave: 'empresa_id', titulo: 'Empresa', tipo: 'id' },
    { clave: 'empresa', titulo: 'Nombre de la empresa', tipo: 'texto' },
    { clave: 'servicios', titulo: 'Servicios activos y limitados', tipo: 'entero' },
    { clave: 'mrr', titulo: 'Ingreso mensual recurrente (MRR)', tipo: 'dinero' },
    { clave: 'arpu', titulo: 'Ingreso promedio por servicio (ARPU)', tipo: 'dinero', nulable: true },
    { clave: 'bajas', titulo: 'Bajas del mes', tipo: 'entero' },
    { clave: 'tasa_bajas', titulo: 'Tasa de bajas del mes (churn) %', tipo: 'porcentaje', nulable: true },
    { clave: 'efectivo_cajas', titulo: 'Efectivo en cajas', tipo: 'dinero', nulable: true },
    { clave: 'efectivo_bancos', titulo: 'Efectivo en bancos', tipo: 'dinero', nulable: true },
    { clave: 'efectivo_total', titulo: 'Efectivo disponible', tipo: 'dinero', nulable: true },
])

async function idsYNombres(op: EmpresasReporte) {
    const filas = (await db
        .from('core.empresas')
        .where('activa', true)
        .if(op.empresas !== null, (q) => q.whereIn('id', op.empresas!))
        .orderBy('id', 'asc')
        .select('id', 'nombre_comercial')) as Array<{ id: number; nombre_comercial: string }>
    return filas.map((f) => ({ id: Number(f.id), nombre: f.nombre_comercial }))
}

function filtrosCon(op: EmpresasReporte, filtros: Record<string, unknown>) {
    return { ...filtros, empresas: op.consolidado ? 'todas' : (op.empresas ?? null) }
}

/** Bajas y tasa de bajas por mes (12 meses por defecto). */
export async function reporteBajas(
    filtros: { desde?: string; hasta?: string },
    op: EmpresasReporte,
    ahora: Date = new Date(),
): Promise<Reporte> {
    const hoy = hoyGuatemala(ahora)
    const hasta = filtros.hasta && filtros.hasta < hoy ? filtros.hasta : hoy
    const desde =
        filtros.desde ??
        DateTime.fromISO(hasta, { zone: 'utc' }).startOf('month').minus({ months: 11 }).toISODate()!
    const meses = mesesEntre(desde, hasta)
    const empresas = await idsYNombres(op)
    const datos = await bajasPorMes(
        empresas.map((e) => e.id),
        meses,
        ahora,
    )
    const filas: Fila[] = []
    if (op.consolidado) {
        for (const e of empresas) {
            for (const b of datos.get(e.id) ?? []) {
                filas.push({
                    empresa_id: e.id,
                    empresa: e.nombre,
                    periodo: b.mes,
                    altas: b.altas,
                    bajas: b.bajas,
                    retiros: b.retiros,
                    suspendidos: b.suspendidos,
                    base: b.base,
                    tasa: b.tasa === null ? null : Number(b.tasa),
                    dias_baja: b.dias_baja,
                })
            }
        }
    } else {
        // una empresa (o varias sin consolidar): una fila por mes con la suma
        for (const [i, mes] of meses.entries()) {
            const del = [...datos.values()].map((l) => l[i]!).filter(Boolean)
            const suma = (k: 'altas' | 'bajas' | 'retiros' | 'suspendidos' | 'base') =>
                del.reduce((n, b) => n + b[k], 0)
            filas.push({
                periodo: mes,
                altas: suma('altas'),
                bajas: suma('bajas'),
                retiros: suma('retiros'),
                suspendidos: suma('suspendidos'),
                base: suma('base'),
                tasa: suma('base') > 0 ? porcentaje(suma('bajas'), suma('base')) : null,
                dias_baja: del[0]?.dias_baja ?? 60,
            })
        }
    }
    const columnas = op.consolidado
        ? [
              { clave: 'empresa_id', titulo: 'Empresa', tipo: 'id' as const },
              { clave: 'empresa', titulo: 'Nombre de la empresa', tipo: 'texto' as const },
              ...COLUMNAS_BAJAS,
          ]
        : COLUMNAS_BAJAS
    const totalBase = filas.length > 0 ? Number(filas[0]!.base ?? 0) : 0
    const totalBajas = filas.reduce((n, f) => n + Number(f.bajas ?? 0), 0)
    return armarReporte({
        reporte: 'bajas',
        titulo: 'Bajas de servicios (churn)',
        columnas,
        filas,
        filtros: filtrosCon(op, { desde, hasta }),
        // base y días no se suman; la tasa del rango = bajas del rango / servicios al inicio del rango
        totales: {
            base: null,
            dias_baja: null,
            tasa: op.consolidado || totalBase === 0 ? null : porcentaje(totalBajas, totalBase),
        },
    })
}

/**
 * Indicadores del panel en una fila por empresa (para exportar y programar). El efectivo solo va
 * con `incluir_efectivo` (quien lo pide tiene `libro.ver`); si no, las columnas quedan vacías.
 */
export async function reporteIndicadores(
    filtros: { mes?: string },
    op: EmpresasReporte,
    opciones: { incluirEfectivo: boolean },
    ahora: Date = new Date(),
): Promise<Reporte> {
    const actual = hoyGuatemala(ahora).slice(0, 7)
    const mes = filtros.mes && filtros.mes < actual ? filtros.mes : actual
    const empresas = await idsYNombres(op)
    const ids = empresas.map((e) => e.id)
    const ingresos = await ingresoRecurrente(ids)
    const bajas = await bajasPorMes(ids, [mes], ahora)
    const efectivo = opciones.incluirEfectivo ? await efectivoDisponible(ids, ahora) : null
    const filas: Fila[] = empresas.map((e) => {
        const i = ingresos.get(e.id) ?? ingresoVacio()
        const b = bajas.get(e.id)?.[0]
        const ef = efectivo ? (efectivo.get(e.id) ?? efectivoVacio()) : null
        return {
            empresa_id: e.id,
            empresa: e.nombre,
            servicios: i.servicios,
            mrr: i.mrr,
            arpu: i.arpu,
            bajas: b?.bajas ?? 0,
            tasa_bajas: b?.tasa === null || b?.tasa === undefined ? null : Number(b.tasa),
            efectivo_cajas: ef?.cajas ?? null,
            efectivo_bancos: ef?.bancos ?? null,
            efectivo_total: ef?.total ?? null,
        }
    })
    return armarReporte({
        reporte: 'indicadores-financieros',
        titulo: 'Indicadores financieros',
        columnas: COLUMNAS_INDICADORES,
        filas,
        filtros: filtrosCon(op, { mes }),
        // el ARPU y la tasa no se suman; sin efectivo, sus columnas no tienen total
        totales: {
            arpu: null,
            tasa_bajas: null,
            ...(efectivo ? {} : { efectivo_cajas: null, efectivo_bancos: null, efectivo_total: null }),
        },
    })
}
