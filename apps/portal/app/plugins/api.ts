import { rutasFixture } from '~~/fixtures'

/** Instancia única del cliente HTTP del portal; se consume con `useApi()`. */
export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig()
    const usarFixtures = config.public.useFixtures === true

    const api = crearClientePortal({
        baseUrl: usarFixtures ? ORIGEN_FIXTURES : config.public.apiBase,
        fetch: usarFixtures ? crearFetchFixtures(rutasFixture, { demoraMs: import.meta.test ? 0 : 150 }) : undefined,
    })

    return {
        provide: { api },
    }
})
