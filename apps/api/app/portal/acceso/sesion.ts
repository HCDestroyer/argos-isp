import { isIP } from 'node:net'
import type { HttpContext } from '@adonisjs/core/http'
import { configIpOrigen, listaConfiables, normalizarIp } from '#portal/ip_origen'
import db from '@adonisjs/lucid/services/db'
import { NoAutenticado, Problema } from '#shared/errores'
import { nodoDeLaPeticion } from '#portal/nodo_portal'
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
    /** cómo se abrió: código al correo/Telegram, documento y contraseña, o «Ver mi cuenta» en `/corte` */
    origen: 'codigo' | 'contrasena' | 'corte'
    /** entró con la contraseña por defecto: solo puede cambiarla o salir */
    debeCambiarContrasena: boolean
    expiraEn: Date
}

export interface OpcionesSesion {
    /**
     * Admite la sesión que aún debe cambiar la contraseña por defecto (`POST /portal/contrasena`,
     * `GET /portal/sesion`, `POST /portal/salir` y las rutas que solo eligen la marca). Las demás
     * responden 403 `cambio_contrasena_requerido`.
     */
    permitirCambioPendiente?: boolean
}

export function tokenDeLaPeticion(ctx: HttpContext): string | null {
    const valor = ctx.request.plainCookie(COOKIE_SESION, { encoded: false })
    return typeof valor === 'string' && valor.startsWith(PREFIJO_TOKEN) ? valor : null
}

/** Sesión vigente de la petición o 401 problem+json. Extiende su vigencia. */
export async function exigirSesionPortal(
    ctx: HttpContext,
    opciones: OpcionesSesion = {},
): Promise<SesionPortal> {
    ctx.response.header('Cache-Control', 'no-store')
    const token = tokenDeLaPeticion(ctx)
    if (!token) throw new SesionPortalRequerida()

    const { sesionInactividadS } = configAcceso()
    const resultado = await db.rawQuery(
        `UPDATE core.portal_sesiones
            SET ultimo_uso = now(),
                expira_en = least(now() + make_interval(secs => ?), expira_max_en)
          WHERE token_hash = ? AND revocada_en IS NULL AND expira_en > now()
          RETURNING id, cliente_id, origen, debe_cambiar_contrasena, expira_en`,
        [sesionInactividadS, hashToken(token)],
    )
    const fila = (
        resultado.rows as {
            id: number
            cliente_id: number
            origen: SesionPortal['origen']
            debe_cambiar_contrasena: boolean
            expira_en: Date
        }[]
    )[0]
    if (!fila) {
        borrarCookieSesion(ctx)
        throw new SesionPortalRequerida('Tu sesión del portal venció. Vuelve a entrar.')
    }
    const sesion: SesionPortal = {
        id: Number(fila.id),
        clienteId: Number(fila.cliente_id),
        origen: fila.origen,
        debeCambiarContrasena: fila.debe_cambiar_contrasena === true,
        expiraEn: fila.expira_en,
    }
    if (sesion.debeCambiarContrasena && !opciones.permitirCambioPendiente) {
        throw new CambioContrasenaRequerido()
    }
    return sesion
}

/** `clienteId` de la sesión vigente (401 si no hay; 403 si debe cambiar la contraseña). */
export async function clienteDeLaSesion(ctx: HttpContext, opciones: OpcionesSesion = {}): Promise<number> {
    const sesion = await exigirSesionPortal(ctx, opciones)
    return sesion.clienteId
}

/**
 * 403: la sesión se abrió con la contraseña por defecto y el cliente aún no la cambió. El portal
 * lleva a `/cambiar-contrasena`.
 */
export class CambioContrasenaRequerido extends Problema {
    constructor() {
        super(
            403,
            'cambio_contrasena_requerido',
            'Cambia tu contraseña',
            'Entraste con la contraseña que te dio la empresa. Elige una propia para seguir.',
        )
    }
}

/**
 * `clienteId` de la sesión si la petición trae una vigente; `null` sin cookie o con una vencida
 * (rutas públicas que solo la usan para elegir la marca, como `GET /portal/empresa`).
 */
export async function clienteDeLaSesionSiHay(ctx: HttpContext): Promise<number | null> {
    if (!tokenDeLaPeticion(ctx)) return null
    try {
        return await clienteDeLaSesion(ctx, { permitirCambioPendiente: true })
    } catch (error) {
        if (error instanceof SesionPortalRequerida) return null
        throw error
    }
}

export class SesionPortalRequerida extends NoAutenticado {
    constructor(detalle = 'Entra a tu cuenta para ver esta información.') {
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
    // Nodo portal remoto: cuenta cómo llegó el navegador al nodo (`X-Argos-Cliente-Proto`), no
    // cómo llegó el nodo a la API (que siempre es HTTPS).
    const nodo = nodoDeLaPeticion(ctx)
    const porHttps = nodo
        ? nodo.https
        : llegoPorHttps(
              ctx.request.request.socket.remoteAddress,
              'encrypted' in ctx.request.request.socket && ctx.request.request.socket.encrypted === true,
              ctx.request.header('x-forwarded-proto'),
          )
    const secure = process.env.PORTAL_COOKIE_SEGURA === 'siempre' || porHttps
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
