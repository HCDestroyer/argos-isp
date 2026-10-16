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

/** Tiempo máximo de espera de la API antes de responder 504 al navegador. */
export const TIEMPO_MAXIMO_API_MS = 15_000

export interface ProblemaProxy {
    type: string
    title: string
    status: 502 | 504
    detail: string
}

/** problem+json para el navegador cuando la API no contesta: 504 si se agotó el tiempo, 502 si no. */
export function problemaApiNoDisponible(error: unknown): ProblemaProxy {
    const causa = (error as { cause?: unknown } | null)?.cause ?? error
    const nombre = (causa as { name?: unknown } | null)?.name
    if (nombre === 'TimeoutError' || nombre === 'AbortError') {
        return {
            type: 'urn:argosisp:problema:api_sin_respuesta',
            title: 'El sistema tardó demasiado',
            status: 504,
            detail: 'El sistema tardó demasiado en responder. Intenta de nuevo en unos segundos.',
        }
    }
    return {
        type: 'urn:argosisp:problema:api_no_disponible',
        title: 'Servicio no disponible',
        status: 502,
        detail: 'No pudimos contactar al sistema. Intenta de nuevo en unos segundos.',
    }
}

/** URL de destino en la API para una ruta del portal (incluye query). `null` si no se reenvía. */
export function destinoReenvio(rutaConQuery: string, apiBaseInternal: string): string | null {
    if (!rutaConQuery.startsWith(PREFIJO_REENVIO) || rutaConQuery.includes('\\')) {
        return null
    }
    let destino: URL
    try {
        destino = new URL(rutaConQuery, apiBaseInternal)
    }
    catch {
        return null
    }
    // `URL` resuelve `/../` y también `%2e%2e`: `/api/v1/portal/%2e%2e/clientes` sería
    // `/api/v1/clientes`. Se revisa la ruta ya resuelta, no la recibida.
    if (!destino.pathname.startsWith(PREFIJO_REENVIO) || /%2e/i.test(destino.pathname)) {
        return null
    }
    return destino.toString()
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Protección CSRF para lo que cambia algo (POST, PUT…): solo desde páginas del mismo portal.
 * Por IP no hace falta cookie, así que un sitio ajeno podría mandar un formulario a
 * `/api/v1/portal/promesas` a nombre de quien lo visita. Los navegadores mandan `Origin` en esas
 * peticiones (y `Sec-Fetch-Site`); si alguno dice que viene de otro sitio, se rechaza (403).
 * Sin ninguna de las dos cabeceras (curl, pruebas) se deja pasar: no es un navegador engañado.
 */
export function origenPermitido(
    metodo: string,
    host: string | undefined,
    origen: string | undefined,
    secFetchSite: string | undefined,
): boolean {
    if (METODOS_SEGUROS.has(metodo.toUpperCase())) {
        return true
    }
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
        return false
    }
    if (origen) {
        if (origen === 'null') {
            return false
        }
        try {
            return new URL(origen).host.toLowerCase() === (host ?? '').toLowerCase()
        }
        catch {
            return false
        }
    }
    return true
}
