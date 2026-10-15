import { BlockList, isIP } from 'node:net'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * IP de origen del cliente para el portal (página de corte).
 *
 * Solo se confía en la cabecera del proxy (`X-Forwarded-For` por defecto) cuando la conexión
 * llega desde un proxy listado en `PORTAL_PROXIES_CONFIABLES`. La cadena se recorre desde la
 * derecha: mientras la IP actual sea un proxy confiable se toma la anterior; la primera que no lo
 * es (o la más a la izquierda) es la del cliente. Lo que un cliente escriba en `X-Forwarded-For`
 * queda a la izquierda del primer proxy y no se usa.
 *
 * Variables (se leen en cada petición; `.env.example` de la API):
 * - `PORTAL_PROXIES_CONFIABLES`: IPs o CIDR (IPv4/IPv6) separados por coma; p. ej. la red de Docker
 *   donde corre el portal (`172.16.0.0/12`). Vacía = no se confía en ninguna cabecera.
 * - `PORTAL_CABECERA_IP`: cabecera a leer (por defecto `x-forwarded-for`).
 */

export interface ConfigIpOrigen {
    proxiesConfiables: string
    cabecera: string
}

export function configIpOrigen(entorno: NodeJS.ProcessEnv = process.env): ConfigIpOrigen {
    return {
        proxiesConfiables: entorno.PORTAL_PROXIES_CONFIABLES ?? '',
        cabecera: (entorno.PORTAL_CABECERA_IP || 'x-forwarded-for').toLowerCase(),
    }
}

/** `::ffff:192.0.2.1` → `192.0.2.1`; quita corchetes y zona (`%eth0`). `null` si no es IP. */
export function normalizarIp(valor: string | undefined | null): string | null {
    if (!valor) return null
    let ip = valor.trim()
    if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined)
    const zona = ip.indexOf('%')
    if (zona >= 0) ip = ip.slice(0, zona)
    const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
    if (mapeada) ip = mapeada[1]!
    return isIP(ip) ? ip.toLowerCase() : null
}

const cacheListas = new Map<string, BlockList>()

/** Lista de proxies confiables. Lanza si una entrada no es IP ni CIDR válido (error de configuración). */
export function listaConfiables(texto: string): BlockList {
    const previa = cacheListas.get(texto)
    if (previa) return previa

    const lista = new BlockList()
    for (const entrada of texto
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)) {
        const [direccion, prefijo] = entrada.split('/')
        const ip = normalizarIp(direccion)
        const familia = ip ? (isIP(ip) === 4 ? 'ipv4' : 'ipv6') : null
        const largo = prefijo === undefined ? (familia === 'ipv4' ? 32 : 128) : Number(prefijo)
        const maximo = familia === 'ipv4' ? 32 : 128
        if (!ip || !familia || !Number.isInteger(largo) || largo < 0 || largo > maximo) {
            throw new Error(`PORTAL_PROXIES_CONFIABLES: entrada inválida "${entrada}"`)
        }
        lista.addSubnet(ip, largo, familia)
    }
    cacheListas.set(texto, lista)
    return lista
}

function esConfiable(ip: string, lista: BlockList): boolean {
    return lista.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}

/**
 * Resuelve la IP del cliente a partir de la dirección del socket y la cabecera del proxy.
 * Devuelve `null` solo si el socket no trae una IP válida.
 */
export function resolverIpOrigen(
    remota: string | undefined,
    cabecera: string | undefined,
    config: ConfigIpOrigen,
): string | null {
    let ip = normalizarIp(remota)
    if (!ip || !cabecera || !config.proxiesConfiables.trim()) return ip

    const lista = listaConfiables(config.proxiesConfiables)
    const cadena = cabecera.split(',')
    while (esConfiable(ip, lista) && cadena.length > 0) {
        const anterior = normalizarIp(cadena.pop())
        // Entrada ilegible: no se puede seguir la cadena; se queda la última IP confiable conocida.
        if (!anterior) break
        ip = anterior
    }
    return ip
}

/** IP de origen de la petición HTTP según la configuración del entorno. */
export function ipOrigenDeLaPeticion(ctx: HttpContext): string | null {
    const config = configIpOrigen()
    return resolverIpOrigen(
        ctx.request.request.socket.remoteAddress,
        ctx.request.header(config.cabecera),
        config,
    )
}
