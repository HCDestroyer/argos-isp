import { isIP } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema, ValidacionFallida } from '#shared/errores'

/**
 * Configuración del túnel WireGuard hacia los routers (`contratos/conexion-routers.md` §1 y §6). Las
 * variables son las mismas del servicio `wireguard` en los compose de A6 y se leen en cada uso.
 *
 * - `ARGOSISP_WIREGUARD` (`1` = activo): sin él no se generan scripts (503 `wireguard_no_configurado`).
 * - `ARGOSISP_WG_RED` (`10.255.0.0/16`): red del túnel; el servidor es la primera IP (`.1`).
 * - `ARGOSISP_WG_PUERTO` (51820): puerto UDP del servidor.
 * - `ARGOSISP_WG_ENDPOINT`: nombre o IPv4 pública del servidor (el endpoint del peer en el router).
 * - La clave pública del servidor la publica el `wireguard-agente` (`POST internal/wireguard/estado`,
 *   `network.wireguard_servidor`); la privada nunca llega a la API.
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
    const endpoint = entorno.ARGOSISP_WG_ENDPOINT?.trim()
    if (!endpoint) {
        throw new WireguardNoConfigurado(
            'Define ARGOSISP_WG_ENDPOINT (nombre o IPv4 pública del servidor WireGuard)',
        )
    }
    return endpoint
}

export function wireguardActivo(entorno: NodeJS.ProcessEnv = process.env): boolean {
    return entorno.ARGOSISP_WIREGUARD?.trim() === '1'
}

/** Clave pública que publicó el `wireguard-agente`; null si todavía no informó. */
export async function clavePublicaServidor(
    cliente: QueryClientContract = db.connection(),
): Promise<string | null> {
    const fila = (await cliente
        .from('network.wireguard_servidor')
        .where('id', 1)
        .select('public_key')
        .first()) as {
        public_key: string
    } | null
    return fila?.public_key ?? null
}

/** Todo lo que necesita el script; 503 `wireguard_no_configurado` si falta algo. */
export async function configWireguard(
    cliente: QueryClientContract = db.connection(),
    entorno: NodeJS.ProcessEnv = process.env,
): Promise<ConfigWireguard> {
    if (!wireguardActivo(entorno)) {
        throw new WireguardNoConfigurado(
            'WireGuard está apagado en este servidor (ARGOSISP_WIREGUARD=1 lo activa)',
        )
    }
    const red = leerRedTunel(entorno.ARGOSISP_WG_RED)
    const puerto = leerPuerto(entorno.ARGOSISP_WG_PUERTO)
    const endpoint = leerEndpoint(entorno)
    const clavePublica = await clavePublicaServidor(cliente)
    if (!clavePublica) {
        throw new WireguardNoConfigurado(
            'El servidor WireGuard todavía no publicó su clave pública: revisa que el servicio wireguard esté arriba',
        )
    }
    return { red, puerto, endpoint, clavePublica }
}

/**
 * Origen público de la API (`API_PUBLIC_URL`, sin barra final ni ruta), al que el router manda su
 * registro antes de tener túnel. Sin él, el origen de la petición. Debe ser `https://` (el router
 * verifica el certificado): si no, 503 `wireguard_no_configurado`.
 */
export function urlBaseApi(origenPeticion: string, entorno: NodeJS.ProcessEnv = process.env): string {
    const valor = (entorno.API_PUBLIC_URL?.trim() || origenPeticion).replace(/\/+$/, '')
    let url: URL
    try {
        url = new URL(valor)
    } catch {
        throw new WireguardNoConfigurado(`API_PUBLIC_URL inválida (${valor})`)
    }
    if (url.protocol !== 'https:') {
        throw new WireguardNoConfigurado(
            'El router se registra por HTTPS: define API_PUBLIC_URL con https:// (el origen público de la API)',
        )
    }
    return url.origin
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
