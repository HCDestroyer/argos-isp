import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from './schema.js'

export type { components, paths, operations } from './schema.js'

/** Esquemas del OpenAPI por nombre: `Schema<'Cliente'>`. */
export type Schema<N extends keyof components['schemas']> = components['schemas'][N]

/** Error RFC 9457 que devuelve la API. */
export type Problem = components['schemas']['Problem']

export interface ApiClientOptions {
    baseUrl: string
    /** Devuelve el token Bearer vigente, o null si no hay sesión. */
    getToken?: () => string | null | undefined
    /**
     * Sesión del panel por cookie HttpOnly (`POST /api/v1/auth/sesion`): devuelve el `csrf` vigente.
     * Se manda en `X-CSRF-Token` en POST, PUT y DELETE. Usar con `credentials: 'include'` y sin
     * `getToken`. Contrato: `.claude/integration/contratos/sesion-panel.md`.
     */
    getCsrf?: () => string | null | undefined
    fetch?: typeof globalThis.fetch
    credentials?: RequestCredentials
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Cliente HTTP tipado contra el OpenAPI de `apps/api`. */
export function createApiClient(options: ApiClientOptions) {
    const client = createClient<paths>({
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        credentials: options.credentials,
    })
    const auth: Middleware = {
        onRequest({ request }) {
            const token = options.getToken?.()
            if (token) request.headers.set('Authorization', `Bearer ${token}`)
            const csrf = METODOS_SEGUROS.has(request.method.toUpperCase()) ? null : options.getCsrf?.()
            if (csrf) request.headers.set('X-CSRF-Token', csrf)
            return request
        },
    }
    client.use(auth)
    return client
}

export type ApiClient = ReturnType<typeof createApiClient>
