/** Enmascarado de texto libre del registro del sistema y de las corridas de crons (sin dependencias). */

const CLAVE_SENSIBLE =
    /\b(pass_ppp|password|passwd|contrase(?:n|ñ)a|clave|secret|secreto|radius_secret|token|api_key|credencial(?:es)?)(\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi
const TOKENS = /\b(atk_|oat_|argn_|Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/g

/** Enmascara pares `clave=valor` sensibles y tokens conocidos en un texto (como la auditoría). */
export function enmascararTexto(texto: string | null | undefined): string | null {
    if (!texto) return null
    const limpio = texto
        .replace(CLAVE_SENSIBLE, (_m, clave: string, sep: string) => `${clave}${sep}***`)
        .replace(TOKENS, (_m, prefijo: string) => `${prefijo}***`)
    return limpio.length > 500 ? `${limpio.slice(0, 497)}…` : limpio
}
