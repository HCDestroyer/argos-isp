import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { Problema, ValidacionFallida } from '#shared/errores'

/**
 * Configuración del túnel WireGuard hacia los routers (`contratos/conexion-routers.md` §1). Las
 * variables las comparte el servicio `wireguard` de A6 (compose) y se leen en cada uso: cambiar la
 * red o el endpoint no exige reiniciar la API.
 *
 * - `ARGOSISP_WG_RED` (`10.255.0.0/16`): red del túnel; el servidor es la primera IP (`.1`).
 * - `ARGOSISP_WG_PUERTO` (51820): puerto UDP del servidor.
 * - `ARGOSISP_WG_ENDPOINT`: host o IP pública del servidor que el router usa como endpoint. Vacío:
 *   el host de `API_PUBLIC_URL`.
 * - `ARGOSISP_WG_CLAVE_PUBLICA` o `ARGOSISP_WG_CLAVE_PUBLICA_ARCHIVO`: clave pública del servidor
 *   (la privada nunca la ve la API). El archivo lo escribe el instalador de A6.
 */

export interface RedTunel {
    /** `10.255.0.0/16` normalizada */
    cidr: string
    /** dirección de red como entero */
    base: number
    prefijo: number
    /** IP del servidor en el túnel (la primera de la red) */
    servidor: string
}

export interface ConfigWireguard {
    red: RedTunel
    puerto: number
    endpoint: string
    clavePublica: string
}

export const RED_POR_DEFECTO = '10.255.0.0/16'
export const PUERTO_POR_DEFECTO = 51820
/** Clave pública WireGuard: 32 bytes en base64 (44 caracteres con un `=` final). */
export const PATRON_CLAVE_WG = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/

export class WireguardNoConfigurado extends Problema {
    constructor(detalle: string) {
        super(503, 'wireguard_no_configurado', 'WireGuard sin configurar', detalle)
    }
}

export function ipAEntero(ip: string): number {
    return ip.split('.').reduce((acc, octeto) => acc * 256 + Number(octeto), 0)
}

export function enteroAIp(valor: number): string {
    return [24, 16, 8, 0].map((corrimiento) => Math.floor(valor / 2 ** corrimiento) % 256).join('.')
}

/** Red IPv4 del túnel (entre /8 y /29, para que quepan servidor y al menos un router). */
export function leerRedTunel(valor: string | undefined = process.env.ARGOSISP_WG_RED): RedTunel {
    const texto = valor?.trim() || RED_POR_DEFECTO
    const [ip, prefijoTexto] = texto.split('/') as [string, string | undefined]
    const prefijo = Number(prefijoTexto)
    if (isIP(ip) !== 4 || !Number.isInteger(prefijo) || prefijo < 8 || prefijo > 29) {
        throw new WireguardNoConfigurado(
            `ARGOSISP_WG_RED inválida (${texto}): se espera una red IPv4 /8 a /29`,
        )
    }
    const tamano = 2 ** (32 - prefijo)
    const base = ipAEntero(ip) - (ipAEntero(ip) % tamano)
    return { cidr: `${enteroAIp(base)}/${prefijo}`, base, prefijo, servidor: enteroAIp(base + 1) }
}

export function leerPuerto(valor: string | undefined = process.env.ARGOSISP_WG_PUERTO): number {
    if (!valor?.trim()) return PUERTO_POR_DEFECTO
    const puerto = Number(valor)
    if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
        throw new WireguardNoConfigurado(`ARGOSISP_WG_PUERTO inválido (${valor})`)
    }
    return puerto
}

function leerEndpoint(entorno: NodeJS.ProcessEnv): string {
    const directo = entorno.ARGOSISP_WG_ENDPOINT?.trim()
    if (directo) return directo
    const api = entorno.API_PUBLIC_URL?.trim()
    if (api) {
        try {
            return new URL(api).hostname
        } catch {
            // se informa abajo
        }
    }
    throw new WireguardNoConfigurado(
        'Define ARGOSISP_WG_ENDPOINT (host o IP pública del servidor WireGuard) o API_PUBLIC_URL',
    )
}

function leerClavePublica(entorno: NodeJS.ProcessEnv): string {
    let clave = entorno.ARGOSISP_WG_CLAVE_PUBLICA?.trim()
    const archivo = entorno.ARGOSISP_WG_CLAVE_PUBLICA_ARCHIVO?.trim()
    if (!clave && archivo) {
        try {
            clave = readFileSync(archivo, 'utf8').trim()
        } catch {
            throw new WireguardNoConfigurado(`No se pudo leer ARGOSISP_WG_CLAVE_PUBLICA_ARCHIVO (${archivo})`)
        }
    }
    if (!clave) {
        throw new WireguardNoConfigurado(
            'Define ARGOSISP_WG_CLAVE_PUBLICA o ARGOSISP_WG_CLAVE_PUBLICA_ARCHIVO (clave pública del servidor)',
        )
    }
    if (!PATRON_CLAVE_WG.test(clave)) {
        throw new WireguardNoConfigurado('La clave pública del servidor WireGuard no es una clave válida')
    }
    return clave
}

/** Todo lo que necesita el script; 503 `wireguard_no_configurado` si falta algo. */
export function configWireguard(entorno: NodeJS.ProcessEnv = process.env): ConfigWireguard {
    return {
        red: leerRedTunel(entorno.ARGOSISP_WG_RED),
        puerto: leerPuerto(entorno.ARGOSISP_WG_PUERTO),
        endpoint: leerEndpoint(entorno),
        clavePublica: leerClavePublica(entorno),
    }
}

/**
 * URL base pública de la API (sin `/api/v1`), a la que el router manda su registro antes de tener
 * túnel: `API_PUBLIC_URL`, `NOTIFY_API_URL` o, en su defecto, el origen de la petición.
 */
export function urlBaseApi(origenPeticion: string, entorno: NodeJS.ProcessEnv = process.env): string {
    const valor = entorno.API_PUBLIC_URL?.trim() || entorno.NOTIFY_API_URL?.trim() || origenPeticion
    return valor.replace(/\/+$/, '')
}

/**
 * `?admin=` del script: IPs o redes IPv4 separadas por coma (máximo 50), normalizadas. 422 por campo
 * si alguna no es válida.
 */
export function parsearAdmin(valor: string | undefined): string[] {
    if (!valor?.trim()) return []
    const partes = valor
        .split(',')
        .map((parte) => parte.trim())
        .filter(Boolean)
    const invalidas = partes.filter((parte) => {
        const [ip, prefijo] = parte.split('/') as [string, string | undefined]
        if (isIP(ip) !== 4) return true
        if (prefijo === undefined) return false
        const n = Number(prefijo)
        return !/^\d{1,2}$/.test(prefijo) || n < 0 || n > 32
    })
    if (invalidas.length > 0 || partes.length > 50) {
        throw new ValidacionFallida([
            {
                field: 'admin',
                rule: 'ip_lista',
                message:
                    partes.length > 50
                        ? 'Máximo 50 IPs de administración'
                        : `No son IPs o redes IPv4 válidas: ${invalidas.join(', ')}`,
            },
        ])
    }
    return [...new Set(partes)]
}
