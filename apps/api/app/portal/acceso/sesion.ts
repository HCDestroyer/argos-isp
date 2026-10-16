import { isIP } from 'node:net'
import type { HttpContext } from '@adonisjs/core/http'
import { configIpOrigen, listaConfiables, normalizarIp } from '#portal/ip_origen'
import db from '@adonisjs/lucid/services/db'
import { NoAutenticado } from '#shared/errores'
import { COOKIE_SESION, PREFIJO_TOKEN, RUTA_COOKIE, configAcceso, hashToken } from '#portal/acceso/codigos'

/**
 * Sesión del cliente en el portal: token opaco en la cookie httpOnly `argos_portal`
 * (mismo origen, `SameSite=Strict`, ruta `/api/v1/portal`). Alcance: un solo cliente; todas las
 * lecturas del portal autenticado filtran por `clienteId`.
 *
 * Cada uso extiende la sesión `PORTAL_SESION_INACTIVIDAD_S` sin pasar de `expira_max_en`.
 * Actualizar `ultimo_uso` no es una acción de nadie (como el contador del límite): no se audita.
 */

export interface SesionPortal {
    id: number
    clienteId: number
}

export function tokenDeLaPeticion(ctx: HttpContext): string | null {
    const valor = ctx.request.plainCookie(COOKIE_SESION, { encoded: false })
    return typeof valor === 'string' && valor.startsWith(PREFIJO_TOKEN) ? valor : null
}

/** Sesión vigente de la petición o 401 problem+json. Extiende su vigencia. */
export async function exigirSesionPortal(ctx: HttpContext): Promise<SesionPortal> {
    ctx.response.header('Cache-Control', 'no-store')
    const token = tokenDeLaPeticion(ctx)
    if (!token) throw new SesionPortalRequerida()

    const { sesionInactividadS } = configAcceso()
    const resultado = await db.rawQuery(
        `UPDATE core.portal_sesiones
            SET ultimo_uso = now(),
                expira_en = least(now() + make_interval(secs => ?), expira_max_en)
          WHERE token_hash = ? AND revocada_en IS NULL AND expira_en > now()
          RETURNING id, cliente_id`,
        [sesionInactividadS, hashToken(token)],
    )
    const fila = (resultado.rows as { id: number; cliente_id: number }[])[0]
    if (!fila) {
        borrarCookieSesion(ctx)
        throw new SesionPortalRequerida('Tu sesión del portal venció. Pide un código nuevo para entrar.')
    }
    return { id: Number(fila.id), clienteId: Number(fila.cliente_id) }
}

/** `clienteId` de la sesión vigente (401 si no hay). */
export async function clienteDeLaSesion(ctx: HttpContext): Promise<number> {
    const sesion = await exigirSesionPortal(ctx)
    return sesion.clienteId
}

export class SesionPortalRequerida extends NoAutenticado {
    constructor(detalle = 'Entra con el código que te enviamos para ver esta información.') {
        super(detalle)
    }
}

/**
 * ¿La petición llegó por HTTPS? TLS directo en la API, o `X-Forwarded-Proto: https` puesto por un
 * proxy de `PORTAL_PROXIES_CONFIABLES` (el portal de Nitro o el proxy que termina TLS). La cabecera
 * de cualquier otro origen no cuenta.
 */
export function llegoPorHttps(
    remota: string | undefined,
    tls: boolean,
    proto: string | undefined,
    proxiesConfiables: string = configIpOrigen().proxiesConfiables,
): boolean {
    if (tls) return true
    const ip = normalizarIp(remota)
    if (!ip || !proxiesConfiables.trim() || !proto) return false
    const lista = listaConfiables(proxiesConfiables)
    const confiable = lista.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
    return confiable && proto.split(',')[0]?.trim().toLowerCase() === 'https'
}

/**
 * Atributos de la cookie: `HttpOnly` (el JS del portal nunca ve el token), `SameSite=Strict` (no
 * viaja en peticiones iniciadas desde otro sitio; el portal la usa solo con `fetch` del mismo
 * origen), ruta `/api/v1/portal` y `Secure` con HTTPS (`PORTAL_COOKIE_SEGURA=siempre` lo fuerza).
 */
export function opcionesCookie(ctx: HttpContext) {
    const secure =
        process.env.PORTAL_COOKIE_SEGURA === 'siempre' ||
        llegoPorHttps(
            ctx.request.request.socket.remoteAddress,
            'encrypted' in ctx.request.request.socket && ctx.request.request.socket.encrypted === true,
            ctx.request.header('x-forwarded-proto'),
        )
    return { httpOnly: true, sameSite: 'strict' as const, path: RUTA_COOKIE, secure }
}

export function ponerCookieSesion(ctx: HttpContext, token: string): void {
    const { sesionMaxS } = configAcceso()
    ctx.response.plainCookie(COOKIE_SESION, token, {
        ...opcionesCookie(ctx),
        maxAge: sesionMaxS,
        encode: false,
    })
}

export function borrarCookieSesion(ctx: HttpContext): void {
    ctx.response.clearCookie(COOKIE_SESION, opcionesCookie(ctx))
}
