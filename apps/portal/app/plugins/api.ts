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
        fetch: usarFixtures ? fetchFixturesPerezoso() : undefined,
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

/**
 * Los fixtures (~150 KB) se cargan solo en modo fixtures y con la primera llamada: en producción el
 * módulo nunca baja al navegador (antes iba en el bundle de toda página, `/corte` incluida).
 */
function fetchFixturesPerezoso(): typeof fetch {
    let cargado: Promise<typeof fetch> | undefined
    return async (entrada, init) => {
        cargado ??= import('~~/fixtures').then(modulo =>
            crearFetchFixtures(modulo.rutasFixture, { demoraMs: import.meta.test ? 0 : 150 }))
        const fetchFixtures = await cargado
        return fetchFixtures(entrada, init)
    }
}
