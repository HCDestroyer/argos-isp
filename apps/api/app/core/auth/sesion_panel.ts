import { createHmac, timingSafeEqual } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import { errors, symbols } from '@adonisjs/auth'
import type { AuthClientResponse, GuardContract } from '@adonisjs/auth/types'
import { AccessToken } from '@adonisjs/auth/access_tokens'
import db from '@adonisjs/lucid/services/db'
import Usuario, { TOKENS_SESION } from '#core/models/usuario'
import { appKey } from '#config/app'
import { Problema } from '#shared/errores'
import { origenPermitido } from '#core/auth/origenes'
import { COOKIE_SESION_PANEL } from '#shared/rutas'
import {
    NOMBRE_TOKEN_PANEL,
    configSesionPanel,
    decidirRenovacion,
    relojSesion,
} from '#core/auth/sesion_deslizante'

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
 * - Vencimiento deslizante (semana 3, tanda 3; `app/core/auth/sesion_deslizante.ts`): cada petición
 *   lleva el vencimiento a `ahora + PANEL_SESION_INACTIVIDAD_H` sin pasar de
 *   `login + PANEL_SESION_MAXIMA_H`; guarda y vuelve a emitir la cookie solo cuando avanza al menos
 *   el umbral (15 min). El `csrf` no cambia al renovar: es el HMAC del token, y el token es el mismo.
 *   La cookie dura hasta el tope (+1 h): quien decide si la sesión sigue viva es `expires_at`.
 *   Vencida (por inactividad o por el tope): 401 `sesion_expirada` y se borra la cookie.
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

/**
 * Margen de la cookie después del tope: así la petición que llega justo tras el tope todavía trae la
 * cookie y recibe 401 `sesion_expirada` (y la cookie se borra) en vez de `no_autenticado`.
 */
export const GRACIA_COOKIE_PANEL_S = 3600

/**
 * Pone la cookie de sesión. Su `Max-Age` llega hasta el **tope absoluto** (`expiraMaxEn`) más
 * `GRACIA_COOKIE_PANEL_S`, no hasta `expira_en`: si el navegador la borrara al vencer por
 * inactividad, la siguiente petición llegaría sin cookie y la API no podría responder
 * `sesion_expirada` (el panel abre la ventana de bloqueo solo con ese `type`). La validez real la
 * decide siempre el servidor con `expires_at` del token.
 */
export function ponerCookieSesionPanel(ctx: HttpContext, token: string, expiraMaxEn: Date | null): void {
    const maxAge = expiraMaxEn
        ? Math.max(
              1,
              Math.floor((expiraMaxEn.getTime() - relojSesion.ahora().getTime()) / 1000) +
                  GRACIA_COOKIE_PANEL_S,
          )
        : undefined
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

/** 401 cuando la sesión del panel venció (inactividad o tope absoluto). El panel vuelve al login. */
export class SesionExpirada extends Problema {
    constructor() {
        super(401, 'sesion_expirada', 'Sesión expirada', 'La sesión del panel venció; inicia sesión de nuevo')
    }
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
    /** la cookie traía una sesión real pero vencida: el middleware responde 401 `sesion_expirada` */
    expirada = false
    /** vencimiento vigente y tope absoluto de la sesión (para `GET /me`) */
    expiraEn: Date | null = null
    expiraMaxEn: Date | null = null
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

        const token = await this.#verificar(valor)
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

    /**
     * Como `DbAccessTokensProvider.verify`, pero sin escribir `last_used_at` en cada petición: la
     * fila solo se toca al renovar el vencimiento (como mucho cada 15 min por sesión activa).
     */
    async #verificar(valor: string): Promise<AccessToken | null> {
        const decodificado = AccessToken.decode(TOKENS_SESION.prefijo, valor)
        if (!decodificado) return null
        const fila = await db
            .from(TOKENS_SESION.tabla)
            .where({ id: decodificado.identifier, type: TOKENS_SESION.tipo })
            .first()
        if (!fila) return null
        const token = new AccessToken({
            identifier: fila.id,
            tokenableId: fila.tokenable_id,
            type: fila.type,
            name: fila.name,
            hash: fila.hash,
            abilities: typeof fila.abilities === 'string' ? JSON.parse(fila.abilities) : fila.abilities,
            createdAt: new Date(fila.created_at),
            updatedAt: new Date(fila.updated_at),
            lastUsedAt: fila.last_used_at ? new Date(fila.last_used_at) : null,
            expiresAt: fila.expires_at ? new Date(fila.expires_at) : null,
        })
        if (!token.verify(decodificado.secret)) return null

        const ahora = relojSesion.ahora()
        // un token de login Bearer metido en la cookie no se desliza: vence a ACCESS_TOKEN_EXPIRA
        if (token.name !== NOMBRE_TOKEN_PANEL) {
            if (token.expiresAt && token.expiresAt <= ahora) {
                this.expirada = true
                return null
            }
            this.expiraEn = token.expiresAt
            this.expiraMaxEn = token.expiresAt
            return token
        }

        const decision = decidirRenovacion(
            { creadaEn: token.createdAt, expiraEn: token.expiresAt },
            ahora,
            configSesionPanel(),
        )
        if (decision.estado === 'expirada') {
            this.expirada = true
            return null
        }
        if (decision.renovar) {
            await db
                .from(TOKENS_SESION.tabla)
                .where({ id: fila.id, type: TOKENS_SESION.tipo })
                .update({ expires_at: decision.expiraEn, last_used_at: ahora, updated_at: ahora })
            token.expiresAt = decision.expiraEn
            token.lastUsedAt = ahora
            ponerCookieSesionPanel(this.ctx, valor, decision.expiraMaxEn)
        }
        this.expiraEn = decision.expiraEn
        this.expiraMaxEn = decision.expiraMaxEn
        return token
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
