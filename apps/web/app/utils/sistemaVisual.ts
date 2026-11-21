import Decimal from 'decimal.js'

/**
 * Utilidades del sistema visual Argos (`docs/sistema-visual.md`): iniciales y tono de los avatares,
 * y tendencia de las tarjetas KPI.
 */

/** «María José Pérez» → «MJ»; «taller» → «T»; vacío → «?». */
export function inicialesDe(nombre: string): string {
    const partes = nombre.trim().split(/\s+/).filter(Boolean)
    if (!partes.length) {
        return '?'
    }
    return partes.slice(0, 2).map(parte => parte.charAt(0).toUpperCase()).join('')
}

/** Ranura 1–5 de la paleta categórica derivada del texto (estable: mismo texto, mismo tono). */
export function tonoDeTexto(texto: string): 1 | 2 | 3 | 4 | 5 {
    let suma = 0
    for (const caracter of texto) {
        suma = (suma * 31 + caracter.charCodeAt(0)) % 9973
    }
    return ((suma % 5) + 1) as 1 | 2 | 3 | 4 | 5
}

export interface Tendencia {
    /** Variación en por ciento con un decimal, o `null` si no hay base para comparar. */
    porcentaje: number | null
    direccion: 'sube' | 'baja' | 'igual'
    texto: string
}

/**
 * Tendencia del último valor contra el anterior. Sin valor anterior (o en cero) no hay porcentaje:
 * se dice «sin comparación», nunca un 100 % inventado.
 */
export function tendenciaDe(valores: readonly (number | string)[]): Tendencia {
    const actual = valores.at(-1)
    const anterior = valores.at(-2)
    if (actual === undefined || anterior === undefined || new Decimal(anterior).isZero()) {
        return { porcentaje: null, direccion: 'igual', texto: 'sin comparación' }
    }
    // Montos con decimal.js (regla 4); el porcentaje ya es solo para mostrar.
    const porcentaje = new Decimal(actual).minus(anterior).div(anterior).times(100).toDecimalPlaces(1).toNumber()
    const direccion = porcentaje > 0 ? 'sube' : porcentaje < 0 ? 'baja' : 'igual'
    const signo = porcentaje > 0 ? '+' : ''
    return { porcentaje, direccion, texto: `${signo}${porcentaje.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` }
}
