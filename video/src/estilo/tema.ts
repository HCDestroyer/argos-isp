import { fontFamily as familiaInter, loadFont as cargarInter } from '@remotion/google-fonts/Inter'
import { fontFamily as familiaJetBrains, loadFont as cargarJetBrains } from '@remotion/google-fonts/JetBrainsMono'
import { fontFamily as familiaSpaceGrotesk, loadFont as cargarSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk'
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion'
import { FUENTES_LOCALES } from './fuentes-locales'

/** Paleta: fondo casi negro y tres neones. Las capturas no usan estos colores. */
export const COLOR = {
    fondo: '#05060a',
    fondoPanel: '#0b0d14',
    cian: '#22d3ee',
    magenta: '#e879f9',
    violeta: '#a78bfa',
    texto: '#e8ecf4',
    textoSuave: '#9aa3b5',
    tenue: '#1b2030',
} as const

/**
 * Fuentes: Space Grotesk (títulos), Inter (texto) y JetBrains Mono (detalles).
 *
 * Por defecto se cargan los archivos de public/fuentes/, descargados de Google
 * Fonts con las URLs de @remotion/google-fonts (`pnpm fuentes`), para que el
 * render no dependa de la red. Con `FUENTES_EN_LINEA = true` se cargan
 * directamente con @remotion/google-fonts desde fonts.gstatic.com.
 */
const FUENTES_EN_LINEA = false

if (FUENTES_EN_LINEA) {
    cargarSpaceGrotesk('normal', { weights: ['300', '400', '500', '600', '700'], subsets: ['latin', 'latin-ext'] })
    cargarInter('normal', { weights: ['400', '500', '600'], subsets: ['latin', 'latin-ext'] })
    cargarJetBrains('normal', { weights: ['400', '500'], subsets: ['latin', 'latin-ext'] })
} else if (typeof document !== 'undefined') {
    const espera = delayRender('Cargando fuentes locales')
    Promise.all(
        FUENTES_LOCALES.map(async (f) => {
            const cara = new FontFace(f.familia, `url(${staticFile(`fuentes/${f.archivo}`)}) format('woff2')`, {
                weight: f.peso,
                unicodeRange: f.rango,
                display: 'block',
            })
            await cara.load()
            document.fonts.add(cara)
        })
    )
        .then(() => continueRender(espera))
        .catch((error) => cancelRender(error))
}

export const FUENTE = {
    titulo: `"${familiaSpaceGrotesk}", "Inter", sans-serif`,
    cuerpo: `"${familiaInter}", sans-serif`,
    mono: `"${familiaJetBrains}", monospace`,
} as const

/** Convierte #rrggbb + alfa (0..1) en rgba(). */
export function conAlfa(hex: string, alfa: number): string {
    const valor = parseInt(hex.slice(1), 16)
    const r = (valor >> 16) & 255
    const g = (valor >> 8) & 255
    const b = valor & 255
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alfa)).toFixed(3)})`
}
