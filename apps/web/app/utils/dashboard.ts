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

/** Porcentaje entero (redondeo hacia abajo) de `parte` sobre `total`; `null` si no hay total. */
function porcentaje(parte: Decimal, total: Decimal): number | null {
    return total.gt(0) ? parte.div(total).times(100).floor().toNumber() : null
}

/**
 * Hallazgo principal de "Facturado y cobrado": cuánto de lo facturado en el último mes ya se
 * cobró, comparado con los meses anteriores. Sin facturación en el mes, lo dice; nunca un 0 %
 * inventado.
 */
export function hallazgoMontos(resumen: Pick<Resumen, 'series'>): string {
    const meses = resumen.series
    const ultimo = meses.at(-1)
    if (!ultimo) {
        return 'Sin meses en el resumen.'
    }
    const nombre = etiquetaPeriodo(ultimo.periodo)
    const actual = porcentaje(new Decimal(ultimo.cobrado), new Decimal(ultimo.facturado))
    if (actual === null) {
        return `Sin facturación en ${nombre}; cobrado ${formatearQuetzales(ultimo.cobrado)}.`
    }
    const anteriores = meses.slice(0, -1)
    const facturado = anteriores.reduce((suma, m) => suma.plus(m.facturado), new Decimal(0))
    const cobrado = anteriores.reduce((suma, m) => suma.plus(m.cobrado), new Decimal(0))
    const previo = porcentaje(cobrado, facturado)
    const antes = anteriores.length === 1 ? 'en el mes anterior' : `en los ${anteriores.length} meses anteriores`
    const comparacion = previo === null ? '' : `; ${antes}, el ${previo} %`
    return `En ${nombre} se ha cobrado el ${actual} % de lo facturado${comparacion}.`
}

/** Hallazgo de "Facturas y pagos": cómo cambió el número de facturas emitidas en el periodo. */
export function hallazgoConteos(resumen: Pick<Resumen, 'series'>): string {
    const conFacturas = resumen.series.filter(m => m.facturas > 0)
    const primero = conFacturas.at(0)
    const ultimo = resumen.series.at(-1)
    if (!primero || !ultimo) {
        return 'Sin facturas emitidas en los últimos 12 meses.'
    }
    const miles = (n: number) => n.toLocaleString('es-GT')
    const pagos = `${miles(ultimo.pagos)} ${ultimo.pagos === 1 ? 'pago registrado' : 'pagos registrados'}`
    if (primero.periodo === ultimo.periodo) {
        return `${miles(ultimo.facturas)} facturas emitidas y ${pagos} en ${etiquetaPeriodo(ultimo.periodo)}.`
    }
    return `Las facturas emitidas pasaron de ${miles(primero.facturas)} en ${etiquetaPeriodo(primero.periodo)} a ${miles(ultimo.facturas)} en ${etiquetaPeriodo(ultimo.periodo)}, con ${pagos} en el último mes.`
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
