import { createHmac, timingSafeEqual } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import { Secret } from '@adonisjs/core/helpers'
import { errors, symbols } from '@adonisjs/auth'
import type { AuthClientResponse, GuardContract } from '@adonisjs/auth/types'
import type { AccessToken } from '@adonisjs/auth/access_tokens'
import Usuario from '#core/models/usuario'
import { appKey } from '#config/app'
import { Problema } from '#shared/errores'
import { origenPermitido } from '#core/auth/origenes'
import { COOKIE_SESION_PANEL } from '#shared/rutas'

/**
 * Sesión del panel en cookie `HttpOnly` (semana 3, tanda 2). Contrato:
 * `.claude/integration/contratos/sesion-panel.md`.
 *
 * - `POST /auth/login` con `X-Sesion: cookie` pone el token de login (`oat_...`, el mismo de
 *   `core.auth_access_tokens`) en la cookie `argos_sesion`: `HttpOnly`, `SameSite=Strict`,
 *   `Path=/api`, `Secure` (salvo `PANEL_COOKIE_SEGURA=false` en desarrollo). El cuerpo no lleva el
 *   token: el JavaScript del panel nunca lo ve.
 * - El guard `panel` autentica con esa cookie solo si la petición no trae `Authorization`: un
 *   Bearer explícito (tokens de API, agentes, aaa/coa, pruebas) siempre gana y nunca se mezcla.
 * - CSRF en métodos no seguros (POST, PUT, DELETE…) con sesión por cookie, en dos capas:
 *   1. `X-CSRF-Token` igual al token sincronizador `HMAC(APP_KEY, token de sesión)`. Lo entregan el
 *      login y `GET /me`. Va ligado a la sesión (cambia con cada login, muere con ella) y no
 *      necesita estado. No usamos una cookie legible (doble envío): con el panel y la API en
 *      orígenes distintos el JavaScript del panel no puede leer cookies de la API.
 *   2. `Origin`, si viene, debe ser un origen permitido (`app/core/auth/origenes.ts`).
 *   `SameSite=Strict` ya impide que la cookie viaje desde otro sitio; las dos capas cubren los
 *   orígenes del mismo sitio (otro subdominio) y navegadores sin `SameSite`.
 */

export { COOKIE_SESION_PANEL }
export const RUTA_COOKIE_PANEL = '/api'
export const CABECERA_MODO_SESION = 'x-sesion'
export const CABECERA_CSRF = 'x-csrf-token'

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** `X-Sesion: cookie` en el login pide la sesión en cookie en vez del token en el cuerpo. */
export function pideSesionCookie(ctx: HttpContext): boolean {
    return (ctx.request.header(CABECERA_MODO_SESION) ?? '').trim().toLowerCase() === 'cookie'
}

/** `Secure` por defecto; `PANEL_COOKIE_SEGURA=false` lo quita (desarrollo por http con IP o nombre). */
export function cookieSegura(entorno: NodeJS.ProcessEnv = process.env): boolean {
    const valor = (entorno.PANEL_COOKIE_SEGURA ?? '').trim().toLowerCase()
    return !(valor === 'false' || valor === '0' || valor === 'no')
}

export function opcionesCookiePanel() {
    return {
        httpOnly: true,
        sameSite: 'strict' as const,
        path: RUTA_COOKIE_PANEL,
        secure: cookieSegura(),
    }
}

/** Token CSRF sincronizador de una sesión: `HMAC-SHA256(APP_KEY, 'csrf:' + token)` en base64url. */
export function csrfDeSesion(tokenSesion: string): string {
    return createHmac('sha256', appKey.release()).update(`csrf:${tokenSesion}`).digest('base64url')
}

function iguales(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function ponerCookieSesionPanel(ctx: HttpContext, token: string, expiraEn: Date | null): void {
    const maxAge = expiraEn ? Math.max(1, Math.floor((expiraEn.getTime() - Date.now()) / 1000)) : undefined
    ctx.response.plainCookie(COOKIE_SESION_PANEL, token, {
        ...opcionesCookiePanel(),
        ...(maxAge ? { maxAge } : {}),
        encode: false,
    })
}

export function borrarCookieSesionPanel(ctx: HttpContext): void {
    ctx.response.clearCookie(COOKIE_SESION_PANEL, opcionesCookiePanel())
}

export function tokenDeCookie(ctx: HttpContext): string | null {
    const valor = ctx.request.plainCookie(COOKIE_SESION_PANEL, { encoded: false })
    return typeof valor === 'string' && valor.length > 0 ? valor : null
}

export class CsrfInvalido extends Problema {
    constructor(detalle: string) {
        super(403, 'csrf_invalido', 'Protección CSRF', detalle)
    }
}

/** Verifica `Origin` y `X-CSRF-Token` en un método no seguro con sesión por cookie. */
export function verificarCsrf(ctx: HttpContext, tokenSesion: string): void {
    if (METODOS_SEGUROS.has(ctx.request.method().toUpperCase())) return
    const origen = ctx.request.header('origin')
    if (origen !== undefined && !origenPermitido(origen, ctx.request.header('host'))) {
        throw new CsrfInvalido('El origen de la petición no está permitido')
    }
    const enviado = ctx.request.header(CABECERA_CSRF) ?? ''
    if (!enviado || !iguales(enviado, csrfDeSesion(tokenSesion))) {
        throw new CsrfInvalido('Falta la cabecera X-CSRF-Token o no corresponde a la sesión')
    }
}

/**
 * Login por cookie (`POST /auth/sesion`): contra el "login CSRF" (que otro sitio meta al navegador
 * en una cuenta ajena) exige cuerpo JSON (un formulario HTML no puede mandarlo sin preflight) y,
 * si llega `Origin`, que sea un origen permitido.
 */
export function verificarOrigenLogin(ctx: HttpContext): void {
    const origen = ctx.request.header('origin')
    if (origen !== undefined && !origenPermitido(origen, ctx.request.header('host'))) {
        throw new CsrfInvalido('El origen de la petición no está permitido')
    }
    if (!ctx.request.is(['json'])) {
        throw new CsrfInvalido('El inicio de sesión del panel exige Content-Type: application/json')
    }
}

/** Guard `panel`: sesión de login en la cookie `argos_sesion`. */
export class SesionCookieGuard implements GuardContract<Usuario> {
    declare [symbols.GUARD_KNOWN_EVENTS]: {}

    readonly driverName = 'sesion_cookie' as const

    user?: Usuario & { currentAccessToken: AccessToken }
    /** valor del token de la cookie (para el CSRF y el logout) */
    tokenSesion?: string
    isAuthenticated = false
    authenticationAttempted = false

    constructor(private ctx: HttpContext) {}

    getUserOrFail(): Usuario & { currentAccessToken: AccessToken } {
        if (!this.user) {
            throw new errors.E_UNAUTHORIZED_ACCESS('Unauthorized access', {
                guardDriverName: this.driverName,
            })
        }
        return this.user
    }

    async authenticate(): Promise<Usuario & { currentAccessToken: AccessToken }> {
        if (this.authenticationAttempted) return this.getUserOrFail()
        this.authenticationAttempted = true

        // un Bearer explícito nunca se combina con la cookie
        if (this.ctx.request.header('authorization')) return this.getUserOrFail()
        const valor = tokenDeCookie(this.ctx)
        if (!valor) return this.getUserOrFail()

        const token = await Usuario.accessTokens.verify(new Secret(valor))
        if (!token) return this.getUserOrFail()
        const usuario = await Usuario.find(token.tokenableId)
        if (!usuario) return this.getUserOrFail()

        const conToken = usuario as Usuario & { currentAccessToken: AccessToken }
        conToken.currentAccessToken = token
        this.user = conToken
        this.tokenSesion = valor
        this.isAuthenticated = true
        return conToken
    }

    async check(): Promise<boolean> {
        try {
            await this.authenticate()
            return true
        } catch (error) {
            if (error instanceof errors.E_UNAUTHORIZED_ACCESS) return false
            throw error
        }
    }

    async authenticateAsClient(): Promise<AuthClientResponse> {
        throw new Error('Para pruebas inicia sesión con X-Sesion: cookie y manda la cookie')
    }
}
