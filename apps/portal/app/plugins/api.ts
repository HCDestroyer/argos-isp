import { rutasFixture } from '~~/fixtures'

/**
 * Instancia única del cliente HTTP del portal; se consume con `useApi()`.
 *
 * Por defecto el navegador llama a la API en el mismo origen del portal (`/api/v1/portal/**`),
 * que Nitro reenvía a `apiBaseInternal`: dentro del walled garden solo hace falta alcanzar el
 * portal, sin CORS. En el servidor (SSR) se usa directamente `apiBaseInternal`.
 */
export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig()
    const usarFixtures = config.public.useFixtures === true
    // Código de corte de `/corte?c=` (modo código del router): va en cada llamada (`X-Argos-Corte`).
    const { codigo, tomarDeLaRuta } = useCodigoCorte()
    if (import.meta.client) {
        tomarDeLaRuta(new URLSearchParams(window.location.search).get('c'))
    }

    const api = crearClientePortal({
        baseUrl: usarFixtures ? ORIGEN_FIXTURES : baseUrlApi(config.public.apiBase, config.apiBaseInternal),
        fetch: usarFixtures ? crearFetchFixtures(rutasFixture, { demoraMs: import.meta.test ? 0 : 150 }) : undefined,
        codigoCorte: () => codigo.value,
    })

    return {
        provide: { api },
    }
})

function baseUrlApi(publica: string, interna: string | undefined): string {
    if (publica) {
        return publica
    }
    return import.meta.client ? window.location.origin : (interna ?? '')
}
