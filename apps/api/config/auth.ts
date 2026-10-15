import { defineConfig } from '@adonisjs/auth'
import { tokensGuard, tokensUserProvider } from '@adonisjs/auth/access_tokens'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

/**
 * Login del panel: tokens de acceso opacos (Bearer) guardados en
 * `core.auth_access_tokens`. Los tokens de API con alcances (`core.tokens_api`)
 * los agrega A1 como un guard adicional.
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
    },
})

export default authConfig

declare module '@adonisjs/auth/types' {
    export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
    interface EventsList extends InferAuthEvents<Authenticators> {}
}
