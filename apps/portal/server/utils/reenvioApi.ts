/**
 * Reenvío del portal a la API (`/api/v1/portal/**` → `apiBaseInternal`).
 *
 * El portal no decide en qué IP confiar: agrega la IP del socket al final de `X-Forwarded-For`
 * y la API toma, desde la derecha, la primera IP que no sea de un proxy listado en su
 * `PORTAL_PROXIES_CONFIABLES`. Así un `X-Forwarded-For` falso enviado por el cliente queda a la
 * izquierda y se ignora mientras el portal (o el proxy inverso de delante) sea el único confiable.
 */

import { BlockList, isIP } from 'node:net'

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

/**
 * Nodo portal remoto (contrato `.claude/integration/contratos/nodo-portal.md`).
 *
 * Dos formas de desplegar un nodo (el portal en otro servidor que la API central):
 * - Con el Caddy del nodo (instalador de A6): el portal no lleva token y reenvía como siempre
 *   (`X-Forwarded-For`) a ese Caddy, que agrega `X-Argos-Nodo-Token` y `X-Argos-Cliente-Ip`.
 * - Sin proxy de salida, con `NUXT_NODO_PORTAL_TOKEN`: el portal resuelve aquí la IP del navegador
 *   (socket, o la cadena de un proxy local listado en `NUXT_PORTAL_PROXIES_CONFIABLES`) y manda él
 *   las cabeceras del nodo. Sin token ni proxies todo sigue exactamente como antes.
 *
 * Lo que el navegador mande en las cabeceras del nodo (`X-Argos-Nodo-Token`, `X-Argos-Cliente-Ip`,
 * `X-Argos-Cliente-Proto`) nunca llega a la API: el handler las borra siempre.
 */

/** `::ffff:192.0.2.1` → `192.0.2.1`; quita corchetes y zona. `null` si no es IP (espejo de la API). */
export function normalizarIp(valor: string | undefined | null): string | null {
    if (!valor) {
        return null
    }
    let ip = valor.trim()
    if (ip.startsWith('[')) {
        ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined)
    }
    const zona = ip.indexOf('%')
    if (zona >= 0) {
        ip = ip.slice(0, zona)
    }
    const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
    if (mapeada) {
        ip = mapeada[1]!
    }
    return isIP(ip) ? ip.toLowerCase() : null
}

const listas = new Map<string, BlockList>()

/** Proxies locales de confianza (IP o CIDR, separados por coma). Lanza con una entrada inválida. */
export function listaConfiables(texto: string): BlockList {
    const previa = listas.get(texto)
    if (previa) {
        return previa
    }
    const lista = new BlockList()
    for (const entrada of texto.split(',').map(e => e.trim()).filter(Boolean)) {
        const [direccion, prefijo] = entrada.split('/')
        const ip = normalizarIp(direccion)
        const familia = ip ? (isIP(ip) === 4 ? 'ipv4' : 'ipv6') : null
        const maximo = familia === 'ipv4' ? 32 : 128
        const largo = prefijo === undefined ? maximo : Number(prefijo)
        if (!ip || !familia || !Number.isInteger(largo) || largo < 0 || largo > maximo) {
            throw new Error(`NUXT_PORTAL_PROXIES_CONFIABLES: entrada inválida "${entrada}"`)
        }
        lista.addSubnet(ip, largo, familia)
    }
    listas.set(texto, lista)
    return lista
}

function esConfiable(ip: string, lista: BlockList): boolean {
    return lista.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}

/**
 * IP del navegador: la del socket o, si el socket es un proxy local confiable, la cadena de
 * `X-Forwarded-For` recorrida desde la derecha (mismo algoritmo que la API en `ip_origen.ts`).
 */
export function resolverIpCliente(
    ipSocket: string | undefined,
    xff: string | undefined,
    proxiesConfiables: string,
): string | null {
    let ip = normalizarIp(ipSocket)
    if (!ip || !xff || !proxiesConfiables.trim()) {
        return ip
    }
    const lista = listaConfiables(proxiesConfiables)
    const cadena = xff.split(',')
    while (esConfiable(ip, lista) && cadena.length > 0) {
        const anterior = normalizarIp(cadena.pop())
        if (!anterior) {
            break
        }
        ip = anterior
    }
    return ip
}

/** `https` | `http` del navegador: el del socket, o `X-Forwarded-Proto` de un proxy local confiable. */
export function resolverProtoCliente(
    ipSocket: string | undefined,
    protoSocket: string,
    xfProto: string | undefined,
    proxiesConfiables: string,
): 'http' | 'https' {
    const ip = normalizarIp(ipSocket)
    if (ip && xfProto && proxiesConfiables.trim() && esConfiable(ip, listaConfiables(proxiesConfiables))) {
        return xfProto.split(',')[0]?.trim().toLowerCase() === 'https' ? 'https' : 'http'
    }
    return protoSocket === 'https' ? 'https' : 'http'
}

/**
 * El token de un nodo solo viaja por HTTPS, o a una API en la misma máquina (127.0.0.0/8, ::1 o
 * `localhost`, p. ej. un túnel). Con `http://` a otro host, el portal no reenvía (502) y avisa en el log.
 */
export function apiAdmiteToken(apiBase: string): boolean {
    let url: URL
    try {
        url = new URL(apiBase)
    }
    catch {
        return false
    }
    if (url.protocol === 'https:') {
        return true
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host === '::1' || /^127\./.test(host)
}

export interface DatosReenvio {
    /** `NUXT_NODO_PORTAL_TOKEN` (vacío = portal local, como siempre) */
    token: string
    proxiesConfiables: string
    ipSocket: string | undefined
    protoSocket: string
    xff: string | undefined
    xfProto: string | undefined
    host: string
}

/**
 * Cabeceras que el portal agrega al reenviar. Sin token: `X-Forwarded-For` con la IP del socket
 * al final (la API, o el Caddy del nodo, decide en qué proxy confiar) y el protocolo del navegador
 * (el del socket, o el `X-Forwarded-Proto` de un proxy local confiable). Con token: el token del
 * nodo y la IP y el protocolo del navegador ya resueltos; sin `X-Forwarded-For`.
 */
export function cabecerasReenvio(datos: DatosReenvio): Record<string, string> {
    const headers: Record<string, string> = { 'x-canal': 'portal', 'x-forwarded-host': datos.host }
    const proto = resolverProtoCliente(datos.ipSocket, datos.protoSocket, datos.xfProto, datos.proxiesConfiables)
    if (!datos.token) {
        headers['x-forwarded-proto'] = proto
        const xff = cadenaReenvio(datos.xff, datos.ipSocket)
        if (xff) {
            headers['x-forwarded-for'] = xff
        }
        return headers
    }
    headers['x-argos-nodo-token'] = datos.token
    headers['x-argos-cliente-proto'] = proto
    const ip = resolverIpCliente(datos.ipSocket, datos.xff, datos.proxiesConfiables)
    if (ip) {
        headers['x-argos-cliente-ip'] = ip
    }
    return headers
}
