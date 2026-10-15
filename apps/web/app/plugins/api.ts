import { createApiClient } from '@argosisp/contracts'
import { rutasFixture } from '~~/fixtures'

/** Nombre de la cookie con el token Bearer del panel. */
export const COOKIE_TOKEN = 'argos_token'

/**
 * Crea la instancia única del cliente HTTP y la cookie del token.
 * Se consumen con `useApi()` y `useAuth()`; no uses `$api` directo en componentes.
 */
export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig()
    const usarFixtures = config.public.useFixtures === true

    const token = useCookie<string | null>(COOKIE_TOKEN, {
        default: () => null,
        sameSite: 'lax',
        maxAge: 60 * 60 * 12,
    })

    const api = createApiClient({
        baseUrl: usarFixtures ? ORIGEN_FIXTURES : config.public.apiBase,
        getToken: () => token.value,
        fetch: usarFixtures ? crearFetchFixtures(rutasFixture, { demoraMs: import.meta.test ? 0 : 150 }) : undefined,
    })

    return {
        provide: {
            api,
            tokenSesion: token,
        },
    }
})
