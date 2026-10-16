import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

type Resumen = Schema<'ResumenDashboard'>

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** `2026-10` → `oct`. */
export function mesCorto(periodo: string): string {
    return MESES_CORTOS[Number(periodo.slice(5, 7)) - 1] ?? periodo
}

export interface SeriesDashboard {
    categorias: string[]
    categoriasLargas: string[]
    montos: SerieGrafica[]
    conteos: SerieGrafica[]
}

/** Series de 12 meses del resumen (el actual al final), listas para `GraficaColumnas`. */
export function seriesDashboard(resumen: Pick<Resumen, 'series'>): SeriesDashboard {
    const meses = resumen.series
    return {
        categorias: meses.map(m => mesCorto(m.periodo)),
        categoriasLargas: meses.map(m => etiquetaPeriodo(m.periodo)),
        montos: [
            { id: 'facturado', nombre: 'Facturado', valores: meses.map(m => m.facturado) },
            { id: 'cobrado', nombre: 'Cobrado', valores: meses.map(m => m.cobrado) },
        ],
        conteos: [
            { id: 'facturas', nombre: 'Facturas emitidas', valores: meses.map(m => m.facturas) },
            { id: 'pagos', nombre: 'Pagos registrados', valores: meses.map(m => m.pagos) },
        ],
    }
}

/** Lo que falta cobrar de lo facturado en el mes (nunca negativo: un anticipo no es deuda). */
export function pendienteMes(mes: Pick<Resumen['mes'], 'facturado' | 'cobrado'>): Decimal {
    return Decimal.max(0, new Decimal(mes.facturado).minus(mes.cobrado))
}

/** `6.79` → `6.79 %`; limitado a 0–100 para la barra. */
export function porcentajeCobranza(pct: number): { texto: string, barra: number } {
    const valor = new Decimal(pct)
    return {
        texto: `${valor.toFixed(valor.isInteger() ? 0 : 2)} %`,
        barra: Decimal.min(100, Decimal.max(0, valor)).toNumber(),
    }
}

/**
 * La vista más vieja del resumen: los números están al día al menos hasta ese momento. `null`
 * si ninguna vista se ha refrescado todavía.
 */
export function actualizacionDashboard(resumen: Pick<Resumen, 'actualizado_en'>): string | null {
    const fechas = Object.values(resumen.actualizado_en).filter((f): f is string => typeof f === 'string')
    if (!fechas.length) {
        return null
    }
    return fechas.reduce((vieja, f) => (new Date(f).getTime() < new Date(vieja).getTime() ? f : vieja))
}

/** ¿Hay algún mes con facturación o cobros? Sin eso la gráfica se reemplaza por un vacío. */
export function haySerie(resumen: Pick<Resumen, 'series'>): boolean {
    return resumen.series.some(m => !new Decimal(m.facturado).isZero() || !new Decimal(m.cobrado).isZero() || m.facturas > 0 || m.pagos > 0)
}
