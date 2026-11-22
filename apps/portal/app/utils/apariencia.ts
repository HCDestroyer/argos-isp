import type { Schema } from '@argosisp/contracts'

/**
 * Apariencia de la instalación que elige el admin (`GET /api/v1/apariencia/publica`, sin sesión;
 * A6, contrato `.claude/integration/contratos/apariencia.md`): tema (`paleta` ya resuelta con sus
 * hex AA), modo claro u oscuro inicial, eslogan y fondo del panel del login. El logo de la empresa
 * sigue saliendo de Empresas (contrato §0): `logo_login_url` y `nombre_marca` no se usan aquí.
 *
 * Todo pasa por `normalizarApariencia` (caída segura): un tema o color fuera del catálogo, un hex
 * mal formado o una URL que no sea la de un archivo de apariencia se ignoran y queda lo de fábrica
 * (índigo, §3). Nada de la respuesta entra al CSS sin validar.
 */
export type AparienciaPublica = Schema<'AparienciaPublica'>
export type PresetTema = AparienciaPublica['tema']

export const PRESETS_TEMA = ['indigo', 'azul', 'violeta', 'esmeralda', 'naranja', 'rosa', 'pizarra'] as const satisfies readonly PresetTema[]

/**
 * Catálogo del contrato (§2): color de Nuxt UI y tono del primario en claro (el que pasa 4,5:1 sobre
 * blanco y con texto blanco). Sirve de respaldo si la `paleta` de la API no llega o no es válida;
 * en oscuro, el 400 de todos.
 */
export const PALETAS_TEMA: Record<PresetTema, { paleta: string, tonoClaro: 600 | 700 }> = {
    indigo: { paleta: 'indigo', tonoClaro: 600 },
    azul: { paleta: 'blue', tonoClaro: 600 },
    violeta: { paleta: 'violet', tonoClaro: 600 },
    esmeralda: { paleta: 'emerald', tonoClaro: 700 },
    naranja: { paleta: 'orange', tonoClaro: 700 },
    rosa: { paleta: 'pink', tonoClaro: 700 },
    pizarra: { paleta: 'slate', tonoClaro: 600 },
}

/** Lo que usa el portal, ya validado. */
export interface Apariencia {
    preset: PresetTema
    /** Color de Nuxt UI (`appConfig.ui.colors.primary`). */
    color: string
    primarioClaro: string | null
    primarioOscuro: string | null
    modo: AparienciaPublica['modo_predeterminado']
    eslogan: string | null
    fondoLogin: string | null
}

export const APARIENCIA_DE_FABRICA: Apariencia = {
    preset: 'indigo',
    color: 'indigo',
    primarioClaro: null,
    primarioOscuro: null,
    modo: 'sistema',
    eslogan: null,
    fondoLogin: null,
}

function esPreset(valor: unknown): valor is PresetTema {
    return typeof valor === 'string' && (PRESETS_TEMA as readonly string[]).includes(valor)
}

function hex(valor: unknown): string | null {
    return typeof valor === 'string' && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : null
}

/** Nombre de un archivo de apariencia tal como lo sirve la API (§7). */
export const NOMBRE_ARCHIVO_APARIENCIA = /^(?:logo|fondo)-login-[0-9a-f]{16}\.(?:png|svg|jpe?g|webp)$/

/**
 * URL del fondo para `url("…")`: solo `/api/v1/apariencia/archivos/<nombre>` (contrato §3, ruta
 * relativa a la API). El portal la sirve en su mismo origen (`server/api/v1/apariencia/archivos`),
 * que es lo único que permite la CSP (`img-src 'self'`).
 */
export function urlImagenSegura(valor: unknown): string | null {
    if (typeof valor !== 'string') {
        return null
    }
    const prefijo = '/api/v1/apariencia/archivos/'
    return valor.startsWith(prefijo) && NOMBRE_ARCHIVO_APARIENCIA.test(valor.slice(prefijo.length)) ? valor : null
}

function textoCorto(valor: unknown, maximo: number): string | null {
    if (typeof valor !== 'string') {
        return null
    }
    const limpio = valor.trim()
    return limpio && limpio.length <= maximo ? limpio : null
}

/** Valida la respuesta de la API; cualquier cosa rara cae a lo de fábrica, campo por campo. */
export function normalizarApariencia(datos: unknown): Apariencia {
    if (!datos || typeof datos !== 'object') {
        return APARIENCIA_DE_FABRICA
    }
    const crudo = datos as Partial<Record<keyof AparienciaPublica, unknown>>
    const preset = esPreset(crudo.tema) ? crudo.tema : 'indigo'
    const paleta = crudo.paleta && typeof crudo.paleta === 'object' ? crudo.paleta as Partial<Record<'color' | 'claro' | 'oscuro', unknown>> : null
    // La paleta de la API solo cuenta si es la del mismo tema (color del catálogo).
    const paletaValida = paleta?.color === PALETAS_TEMA[preset].paleta
    const modo = crudo.modo_predeterminado === 'claro' || crudo.modo_predeterminado === 'oscuro' ? crudo.modo_predeterminado : 'sistema'
    return {
        preset,
        color: PALETAS_TEMA[preset].paleta,
        primarioClaro: paletaValida ? hex(paleta?.claro) : null,
        primarioOscuro: paletaValida ? hex(paleta?.oscuro) : null,
        modo,
        eslogan: textoCorto(crudo.eslogan, 120),
        fondoLogin: urlImagenSegura(crudo.fondo_login_url),
    }
}

/**
 * Variables CSS del tema en `<html style>`: el primario en claro y en oscuro (hex de la `paleta` o el
 * tono del catálogo) y su tono de hover. Los tokens `--ax-*` de `main.css` salen de ellas.
 */
export function variablesTema(apariencia: Apariencia): string {
    const { tonoClaro } = PALETAS_TEMA[apariencia.preset]
    const claro = apariencia.primarioClaro ?? `var(--ui-color-primary-${tonoClaro})`
    const hover = `var(--ui-color-primary-${tonoClaro + 100})`
    const oscuro = apariencia.primarioOscuro ?? 'var(--ui-color-primary-400)'
    return `--ax-primario-claro: ${claro}; --ax-primario-hover: ${hover}; --ax-primario-oscuro: ${oscuro};`
}
