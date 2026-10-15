/**
 * Reenvío del portal a la API (`/api/v1/portal/**` → `apiBaseInternal`).
 *
 * El portal no decide en qué IP confiar: agrega la IP del socket al final de `X-Forwarded-For`
 * y la API toma, desde la derecha, la primera IP que no sea de un proxy listado en su
 * `PORTAL_PROXIES_CONFIABLES`. Así un `X-Forwarded-For` falso enviado por el cliente queda a la
 * izquierda y se ignora mientras el portal (o el proxy inverso de delante) sea el único confiable.
 */

/** Prefijo reenviado. Solo los endpoints del portal: el resto de la API no se expone al walled garden. */
export const PREFIJO_REENVIO = '/api/v1/portal/'

/** `X-Forwarded-For` hacia la API: la cadena recibida más la IP del socket al final. */
export function cadenaReenvio(entrante: string | undefined, ipSocket: string | undefined): string | undefined {
    const previas = (entrante ?? '')
        .split(',')
        .map(parte => parte.trim())
        .filter(Boolean)
    if (ipSocket) {
        previas.push(ipSocket)
    }
    return previas.length > 0 ? previas.join(', ') : undefined
}

/** URL de destino en la API para una ruta del portal (incluye query). `null` si no se reenvía. */
export function destinoReenvio(rutaConQuery: string, apiBaseInternal: string): string | null {
    if (!rutaConQuery.startsWith(PREFIJO_REENVIO)) {
        return null
    }
    return new URL(rutaConQuery, apiBaseInternal).toString()
}
