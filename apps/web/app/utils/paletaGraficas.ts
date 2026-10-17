/**
 * Paleta de gráficas de la identidad "vidrio y luz": copia de `horus-identity/assets/chart-palette.ts`
 * (los mismos valores que usa el portal). Categórica en orden fijo, nunca cíclica; los colores de
 * estado (success/warning/error) nunca se usan como series. Validada para daltonismo (5 ranuras):
 * - claro sobre #ffffff: CVD adyacente ΔE ≥ 9,1; aguamarina, amarillo y magenta < 3:1 de contraste
 *   ⇒ leyenda/etiquetas visibles y tabla alternativa obligatorias.
 * - oscuro: CVD ≥ 8,4, todas ≥ 3:1.
 * Los canvas y los `fill` de SVG necesitan sRGB literal, no var() ni oklch: por eso hex.
 */
export const CATEGORICAL = {
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
} as const

/**
 * Tinta del gráfico por tema, con los mismos valores que los tokens de main.css (neutros zinc).
 * Al cambiar el tema se re-tematiza sin recargar datos.
 */
export const CHART_INK = {
    light: {
        text: '#3f3f46',
        muted: '#52525b',
        grid: '#e4e4e7',
        axis: '#a1a1aa',
        surface: '#ffffff',
    },
    dark: { text: '#e4e4e7', muted: '#a1a1aa', grid: '#232a33', axis: '#4b5563', surface: '#131820' },
} as const

export type ChartMode = keyof typeof CHART_INK

/** Líneas de umbral (aviso / crítico): los colores de estado, solo como referencia, nunca como serie. */
export const THRESHOLD_INK = {
    light: { warning: '#a16207', critical: '#dc2626' },
    dark: { warning: '#e9b949', critical: '#f25c69' },
} as const

/**
 * ArgosIsp: escala secuencial de un solo tono (azul de la ranura 1) para datos ordenados, como
 * la antigüedad de la cartera. No está en la skill; claro de menos a más oscuro y al revés en
 * oscuro, validada contra las superficies de cada tema.
 */
export const SECUENCIAL = {
    light: ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
    dark: ['#184f95', '#2a78d6', '#6da7ec', '#b7d3f6'],
} as const
