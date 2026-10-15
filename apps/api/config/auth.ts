import { defineConfig } from '@adonisjs/auth'
import { tokensGuard, tokensUserProvider } from '@adonisjs/auth/access_tokens'
import type { HttpContext } from '@adonisjs/core/http'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'
import { TokenApiGuard } from '#core/auth/token_api_guard'

/**
 * Login del panel: tokens de acceso opacos (Bearer) guardados en
 * `core.auth_access_tokens`. Tokens de API con alcances (`core.tokens_api`,
 * `Bearer atk_...`): guard `tokens`. El middleware `auth` acepta ambos.
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
    },
})

export default authConfig

declare module '@adonisjs/auth/types' {
    export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
    interface EventsList extends InferAuthEvents<Authenticators> {}
}
