import { defineConfig } from '@adonisjs/auth'
import { tokensGuard, tokensUserProvider } from '@adonisjs/auth/access_tokens'
import type { HttpContext } from '@adonisjs/core/http'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'
import { TokenApiGuard } from '#core/auth/token_api_guard'
import { SesionCookieGuard } from '#core/auth/sesion_panel'

/**
 * Login: tokens de acceso opacos guardados en `core.auth_access_tokens`, como Bearer (guard
 * `api`) o en la cookie `HttpOnly` del panel (guard `panel`, `app/core/auth/sesion_panel.ts`).
 * Tokens de API con alcances (`core.tokens_api`, `Bearer atk_...`): guard `tokens`. El middleware
 * `auth` acepta los tres; la cookie solo cuenta si no viene `Authorization`.
 */
const authConfig = defineConfig({
    default: 'api',
    guards: {
        api: tokensGuard({
            provider: tokensUserProvider({
                tokens: 'accessTokens',
                model: () => import('#core/models/usuario'),
            }),
        }),
        tokens: (ctx: HttpContext) => new TokenApiGuard(ctx),
        panel: (ctx: HttpContext) => new SesionCookieGuard(ctx),
    },
})

export default authConfig

declare module '@adonisjs/auth/types' {
    export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
    interface EventsList extends InferAuthEvents<Authenticators> {}
}
