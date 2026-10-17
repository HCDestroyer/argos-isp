import { createApiClient } from '@argosisp/contracts'
import { cookieSesionFixture, rutasFixture } from '~~/fixtures'

/** Cookie que usaba el panel antes de la sesión `HttpOnly` (token legible por JavaScript). */
export const COOKIE_TOKEN_VIEJA = 'argos_token'

/**
 * Crea la instancia única del cliente HTTP (`contratos/sesion-panel.md`): la sesión vive en la
 * cookie `HttpOnly` `argos_sesion` que pone la API, así que el panel no guarda ningún token. Solo
 * guarda en memoria el `csrf` (`X-CSRF-Token` en POST, PUT y DELETE); tras recargar lo vuelve a
 * leer de `GET /me`. Se consume con `useApi()` y `useAuth()`.
 */
export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig()
    const usarFixtures = config.public.useFixtures === true
    const csrf = useCsrf()

    // La cookie del token de la versión anterior ya no sirve: se borra.
    const vieja = useCookie<string | null>(COOKIE_TOKEN_VIEJA)
    if (vieja.value) {
        vieja.value = null
    }

    /** El `fetch` del panel (el falso en modo fixtures); `sesion.ts` lo usa para repetir con otro `csrf`. */
    const fetchPanel: typeof globalThis.fetch = usarFixtures
        ? crearFetchFixtures(rutasFixture, { demoraMs: import.meta.test ? 0 : 150, cookieSesion: cookieSesionFixture })
        : (entrada, init) => globalThis.fetch(entrada, init)

    const api = createApiClient({
        baseUrl: usarFixtures ? ORIGEN_FIXTURES : config.public.apiBase,
        credentials: 'include',
        getCsrf: () => csrf.value,
        fetch: usarFixtures ? fetchPanel : undefined,
    })

    return {
        provide: {
            api,
            fetchPanel,
        },
    }
})
