import { D, type Dec } from '#ledger/dinero'

/**
 * Lectura de montos del origen. Un monto que no se puede leer **sin ambigüedad** nunca se
 * convierte en 0 ni se adivina: vuelve con su motivo y quien lo lee omite la fila con ese motivo
 * en el reporte (cuenta en el cuadre como omitida).
 *
 * Separador decimal del origen (`punto`, por defecto, o `coma`, cuando el origen lo declara):
 *
 * | Monto          | punto                      | coma                       |
 * | -------------- | -------------------------- | -------------------------- |
 * | `1250.50`      | 1250.50                    | ambiguo, se reporta        |
 * | `1,250.50`     | 1250.50 (coma de miles)    | se reporta                 |
 * | `1,234,567`    | 1234567                    | se reporta                 |
 * | `1,50`         | ambiguo, se reporta        | 1.50                       |
 * | `1,250`        | ambiguo, se reporta        | 1.250                      |
 * | `1.250,50`     | se reporta                 | 1250.50 (punto de miles)   |
 * | `1.250`        | 1.250                      | ambiguo, se reporta        |
 * | `Q 150`, `-20` | 150, -20                   | 150, -20                   |
 * | vacío, `abc`, `1e3`, `0x10`, `Infinity`, `1.2.3` | se reporta | se reporta |
 *
 * El separador de miles solo vale en grupos de tres con el decimal presente (`1,234.50`) o con
 * dos grupos o más (`1,234,567`). Un único separador de miles sin decimal (`1,50`, `1,250` con
 * punto; `1.250`, `150.00` con coma) puede ser de miles o decimal: es ambiguo y se reporta.
 */

export const SEPARADORES_DECIMALES = ['punto', 'coma'] as const
export type SeparadorDecimal = (typeof SEPARADORES_DECIMALES)[number]

export type LecturaMonto = { ok: true; valor: Dec } | { ok: false; motivo: string }

const DIGITOS = /^\d+$/

/** Lee un monto con signo. `motivo` describe el problema sin repetir el valor. */
export function leerMonto(
    crudo: string | null | undefined,
    decimal: SeparadorDecimal = 'punto',
): LecturaMonto {
    const original = (crudo ?? '').trim()
    if (original === '') return { ok: false, motivo: 'está vacío' }
    const signo = /^([+-])\s*/.exec(original)
    let cuerpo = signo ? original.slice(signo[0].length) : original
    cuerpo = cuerpo.replace(/^Q\s*/i, '')
    const negativo = signo?.[1] === '-'

    const [miles, dec] = decimal === 'punto' ? [',', '.'] : ['.', ',']
    const normal = normalizar(cuerpo, miles, dec)
    if (typeof normal !== 'string') return { ok: false, motivo: normal.motivo }
    const valor = new D(normal)
    return { ok: true, valor: negativo && !valor.isZero() ? valor.negated() : valor }
}

/** `cuerpo` sin signo ni moneda → texto con punto decimal y sin separador de miles. */
function normalizar(cuerpo: string, miles: string, dec: string): string | { motivo: string } {
    const nombre = dec === '.' ? 'punto' : 'coma'
    const ilegible = {
        motivo:
            `no es un monto (se espera ${dec === '.' ? '1250.50 o 1,250.50' : '1250,50 o 1.250,50'}` +
            `, separador decimal: ${nombre})`,
    }
    const partesDecimal = cuerpo.split(dec)
    if (partesDecimal.length > 2) return ilegible
    const [entera = '', fraccion] = partesDecimal
    if (fraccion !== undefined && !DIGITOS.test(fraccion)) return ilegible

    const grupos = entera.split(miles)
    if (grupos.length === 1) {
        if (!DIGITOS.test(entera)) return ilegible
        return fraccion === undefined ? entera : `${entera}.${fraccion}`
    }
    // con separador de miles: 1-3 dígitos y grupos de exactamente 3
    const [primero, ...resto] = grupos
    if (!/^\d{1,3}$/.test(primero ?? '') || resto.some((g) => !/^\d{3}$/.test(g))) {
        if (
            fraccion === undefined &&
            grupos.length === 2 &&
            DIGITOS.test(primero ?? '') &&
            DIGITOS.test(resto[0] ?? '')
        ) {
            return ambiguo(miles, dec)
        }
        return ilegible
    }
    // `1,250` (un solo grupo, sin decimal) puede ser 1250 o 1.25
    if (fraccion === undefined && grupos.length === 2) return ambiguo(miles, dec)
    const sinMiles = grupos.join('')
    return fraccion === undefined ? sinMiles : `${sinMiles}.${fraccion}`
}

function ambiguo(miles: string, dec: string) {
    const ejemplo = dec === '.' ? '1.50 o 150 (o 1,250.00)' : '1,50 o 150 (o 1.250,00)'
    const otro = dec === '.' ? 'coma' : 'punto'
    return {
        motivo:
            `es ambiguo: "${miles}" puede ser separador de miles o decimal; escríbelo como ${ejemplo}` +
            ` o declara el separador decimal del origen (--decimal=${otro})`,
    }
}

/**
 * Separador decimal por archivo: `general` para todos y `archivos` para los que lo cambian
 * (`facturas.csv` → `coma`).
 */
export interface FormatoDecimal {
    general: SeparadorDecimal
    archivos: Record<string, SeparadorDecimal>
}

export const FORMATO_PUNTO: FormatoDecimal = { general: 'punto', archivos: {} }

export function decimalDe(formato: FormatoDecimal | undefined, archivo: string): SeparadorDecimal {
    return formato?.archivos[archivo] ?? formato?.general ?? 'punto'
}

/**
 * `--decimal`: `coma` (todo el origen), `facturas.csv:coma,pagos.csv:coma` (solo esos archivos) o
 * `coma,planes.csv:punto` (todo con coma salvo planes). Error con el motivo si no se entiende.
 */
export function parsearFormatoDecimal(texto: string | undefined): FormatoDecimal {
    const formato: FormatoDecimal = { general: 'punto', archivos: {} }
    if (!texto?.trim()) return formato
    const esSeparador = (v: string): v is SeparadorDecimal =>
        (SEPARADORES_DECIMALES as readonly string[]).includes(v)
    let general = false
    for (const parte of texto
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)) {
        const [archivo, valor] = parte.includes(':') ? parte.split(':').map((x) => x.trim()) : [null, parte]
        const sep = (valor ?? '').toLowerCase()
        if (!esSeparador(sep)) {
            throw new Error(`--decimal: "${parte}" no se entiende (punto, coma o <archivo>:<punto|coma>)`)
        }
        if (archivo === null) {
            if (general) throw new Error('--decimal: el separador general va una sola vez')
            general = true
            formato.general = sep
        } else {
            if (!archivo) throw new Error(`--decimal: "${parte}" no dice el archivo`)
            formato.archivos[archivo] = sep
        }
    }
    return formato
}

/** true si todo el formato es punto decimal (lo único que tiene un volcado MySQL). */
export function esSoloPunto(formato: FormatoDecimal): boolean {
    return formato.general === 'punto' && Object.values(formato.archivos).every((s) => s === 'punto')
}
