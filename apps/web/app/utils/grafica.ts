import Decimal from 'decimal.js'

/**
 * Cálculos de las gráficas del panel (SVG propio, sin librería): escala del eje Y con números
 * redondos, etiquetas compactas y totales con `decimal.js`. Los montos llegan como string de la
 * API; solo la geometría (píxeles) pasa a `number`.
 */

export type FormatoGrafica = 'quetzales' | 'entero'

export interface SerieGrafica {
    id: string
    nombre: string
    /** Un valor por categoría (string decimal de la API o conteo); `null` = sin dato. */
    valores: (string | number | null)[]
}

/** Colores: categórico (series distintas) o secuencial (orden, p. ej. antigüedad de la cartera). */
export type EscalaColor = 'categorica' | 'secuencial'

export const MAX_SERIES_CATEGORICAS = 3
export const MAX_SERIES_SECUENCIALES = 4

/** Variable CSS de la serie `indice` (definidas en `assets/css/main.css`, claro y oscuro). */
export function colorSerie(escala: EscalaColor, indice: number): string {
    return escala === 'categorica' ? `var(--viz-${indice + 1})` : `var(--viz-sec-${indice + 1})`
}

export function aDecimal(valor: string | number | null | undefined): Decimal | null {
    if (valor === null || valor === undefined || valor === '') {
        return null
    }
    try {
        const numero = new Decimal(valor)
        return numero.isFinite() ? numero : null
    }
    catch {
        return null
    }
}

/** Suma de los valores de cada categoría (pila), sin contar los `null`. */
export function totalesPorCategoria(series: readonly SerieGrafica[], categorias: number): Decimal[] {
    return Array.from({ length: categorias }, (_, i) => series.reduce((suma, s) => suma.plus(aDecimal(s.valores[i]) ?? 0), new Decimal(0)))
}

/** Máximo que debe caber en el eje: el mayor valor (agrupada) o el mayor total (apilada). */
export function maximoGrafica(series: readonly SerieGrafica[], categorias: number, apilada: boolean): Decimal {
    if (apilada) {
        return Decimal.max(0, ...totalesPorCategoria(series, categorias))
    }
    const valores = series.flatMap(s => s.valores.map(v => aDecimal(v) ?? new Decimal(0)))
    return valores.length ? Decimal.max(0, ...valores) : new Decimal(0)
}

/**
 * Marcas del eje Y: de 0 a un tope redondo (paso 1, 2, 2.5 o 5 × 10ⁿ) con unas `marcas` divisiones.
 * Con máximo 0 devuelve [0, 1] para que el eje no colapse.
 */
export function marcasEje(maximo: Decimal, marcas = 4, entero = false): Decimal[] {
    if (maximo.lte(0)) {
        return [new Decimal(0), new Decimal(1)]
    }
    const crudo = maximo.div(marcas)
    const potencia = new Decimal(10).pow(Math.floor(Math.log10(crudo.toNumber())))
    const normal = crudo.div(potencia)
    const factor = [1, 2, 2.5, 5, 10].find(f => normal.lte(f)) ?? 10
    let paso = potencia.times(factor)
    if (entero && paso.lt(1)) {
        paso = new Decimal(1)
    }
    const cuantas = maximo.div(paso).ceil().toNumber()
    return Array.from({ length: cuantas + 1 }, (_, i) => paso.times(i))
}

function quitarCeros(texto: string): string {
    return texto.includes('.') ? texto.replace(/\.?0+$/, '') : texto
}

/** Etiqueta compacta del eje: `Q 0`, `Q 2.5K`, `Q 1.2M`; enteros: `0`, `5`, `1.5K`. */
export function etiquetaCompacta(valor: Decimal, formato: FormatoGrafica): string {
    const prefijo = formato === 'quetzales' ? 'Q ' : ''
    const absoluto = valor.abs()
    const signo = valor.isNegative() && !valor.isZero() ? '-' : ''
    if (absoluto.gte(1_000_000)) {
        return `${signo}${prefijo}${quitarCeros(absoluto.div(1_000_000).toFixed(1))}M`
    }
    if (absoluto.gte(1000)) {
        return `${signo}${prefijo}${quitarCeros(absoluto.div(1000).toFixed(1))}K`
    }
    return `${signo}${prefijo}${quitarCeros(absoluto.toFixed(formato === 'entero' ? 0 : 2))}`
}

/** Valor completo para tooltip y tabla: `Q 1,234.50` o `1,234`. */
export function etiquetaValor(valor: string | number | null | undefined, formato: FormatoGrafica): string {
    const numero = aDecimal(valor)
    if (numero === null) {
        return '—'
    }
    if (formato === 'quetzales') {
        return formatearQuetzales(numero)
    }
    return numero.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Trayecto SVG de una columna con el extremo de datos redondeado (radio 4) y la base recta,
 * como pide la guía de gráficas. Con alto menor que el radio, el radio se reduce.
 */
export function trayectoColumna(x: number, y: number, ancho: number, alto: number, redondear = true): string {
    if (alto <= 0 || ancho <= 0) {
        return ''
    }
    const r = redondear ? Math.min(4, ancho / 2, alto) : 0
    const base = y + alto
    return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + ancho - r}Q${x + ancho},${y} ${x + ancho},${y + r}V${base}Z`
}
