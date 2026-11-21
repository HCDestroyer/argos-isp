/**
 * Apariencia que elige el admin (`GET /api/v1/apariencia/publica`, sin sesión; A6, contrato
 * `.claude/integration/contratos/apariencia.md`): tema de color, modo claro u oscuro por defecto,
 * eslogan y fondo del panel del login.
 *
 * Mientras el endpoint no esté en `packages/contracts`, el tipo vive aquí (ver
 * `.claude/integration/a5.md`); al publicarse el contrato se cambia por `Schema<'AparienciaPublica'>`.
 *
 * Todo pasa por `normalizarApariencia`: un preset desconocido, un hex mal formado o una URL que no es
 * del mismo origen se ignoran y queda lo de fábrica (índigo). Nada de la respuesta entra al
 * CSS sin validar.
 */

export const PRESETS_TEMA = ['indigo', 'azul', 'violeta', 'esmeralda', 'naranja', 'rosa', 'pizarra'] as const
export type PresetTema = (typeof PRESETS_TEMA)[number]

/**
 * Paleta de Tailwind de cada preset y el tono del primario en claro: el que deja el texto blanco
 * (botones) y el primario sobre blanco en 4,5:1 o más. Esmeralda y naranja necesitan el 700; el resto
 * pasa con el 600. En oscuro, el 400 de todas pasa sobre el azul noche.
 */
export const PALETAS_TEMA: Record<PresetTema, { paleta: string, tonoClaro: 600 | 700 }> = {
    indigo: { paleta: 'indigo', tonoClaro: 600 },
    azul: { paleta: 'blue', tonoClaro: 600 },
    violeta: { paleta: 'violet', tonoClaro: 600 },
    esmeralda: { paleta: 'emerald', tonoClaro: 700 },
    naranja: { paleta: 'orange', tonoClaro: 700 },
    rosa: { paleta: 'rose', tonoClaro: 600 },
    pizarra: { paleta: 'slate', tonoClaro: 600 },
}

export type ModoApariencia = 'claro' | 'oscuro' | 'sistema'

/** Respuesta de la API (forma del contrato; el tema llega como preset o con sus hex validados). */
export interface AparienciaPublica {
    tema: PresetTema | { preset: PresetTema, primario_claro?: string | null, primario_oscuro?: string | null }
    modo_predeterminado: ModoApariencia
    nombre_marca: string | null
    eslogan: string | null
    logo_login_url: string | null
    fondo_login_url: string | null
}

/** Lo que usa el portal, ya validado. */
export interface Apariencia {
    preset: PresetTema
    primarioClaro: string | null
    primarioOscuro: string | null
    modo: ModoApariencia
    eslogan: string | null
    fondoLogin: string | null
}

export const APARIENCIA_DE_FABRICA: Apariencia = {
    preset: 'indigo',
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

/**
 * URL de imagen segura para `url("…")`: solo una ruta del mismo origen (`/…`), sin comillas,
 * paréntesis ni espacios. La CSP del portal (`img-src 'self'`, walled garden) bloquearía una imagen
 * de otro dominio, así que una URL absoluta se ignora y queda el fondo de fábrica.
 */
export function urlImagenSegura(valor: unknown): string | null {
    if (typeof valor !== 'string' || valor.length > 2048 || /["'()\\\s<>]/.test(valor)) {
        return null
    }
    return /^\/[^/]/.test(valor) ? valor : null
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
    const tema = crudo.tema
    const objeto = tema && typeof tema === 'object' ? tema as Record<string, unknown> : null
    const preset = esPreset(tema) ? tema : esPreset(objeto?.preset) ? objeto.preset : 'indigo'
    const modo = crudo.modo_predeterminado === 'claro' || crudo.modo_predeterminado === 'oscuro' ? crudo.modo_predeterminado : 'sistema'
    return {
        preset,
        primarioClaro: hex(objeto?.primario_claro),
        primarioOscuro: hex(objeto?.primario_oscuro),
        modo,
        eslogan: textoCorto(crudo.eslogan, 160),
        fondoLogin: urlImagenSegura(crudo.fondo_login_url),
    }
}

/**
 * Variables CSS del tema en `<html style>`: el primario en claro y en oscuro (hex validado de la API
 * o el tono AA del preset) y su tono de hover. Los tokens `--ax-*` de `main.css` salen de ellas.
 */
export function variablesTema(apariencia: Apariencia): string {
    const { tonoClaro } = PALETAS_TEMA[apariencia.preset]
    const claro = apariencia.primarioClaro ?? `var(--ui-color-primary-${tonoClaro})`
    const hover = `var(--ui-color-primary-${tonoClaro + 100})`
    const oscuro = apariencia.primarioOscuro ?? 'var(--ui-color-primary-400)'
    return `--ax-primario-claro: ${claro}; --ax-primario-hover: ${hover}; --ax-primario-oscuro: ${oscuro};`
}
