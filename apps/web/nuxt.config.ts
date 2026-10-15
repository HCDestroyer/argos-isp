// Panel de administración de ArgosIsp.
// SPA (ssr: false): el panel no necesita SEO y así el navegador habla directo con la API
// usando el token Bearer guardado en cookie. Nitro solo sirve el shell en el puerto 3000.
export default defineNuxtConfig({
    modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxt/test-utils/module'],

    ssr: false,

    devtools: { enabled: false },

    app: {
        head: {
            htmlAttrs: { lang: 'es' },
            title: 'ArgosIsp',
            meta: [{ name: 'description', content: 'Panel de administración de ArgosIsp' }],
        },
    },

    css: ['~/assets/css/main.css'],

    // Sin Google Fonts ni Iconify remoto: fuentes del sistema e iconos lucide locales.
    ui: {
        fonts: false,
    },

    runtimeConfig: {
        public: {
            // NUXT_PUBLIC_API_BASE
            apiBase: 'http://localhost:3333',
            // NUXT_PUBLIC_USE_FIXTURES=true responde desde apps/web/fixtures sin backend.
            useFixtures: false,
        },
    },

    compatibilityDate: '2026-10-01',

    typescript: {
        strict: true,
        typeCheck: false,
    },

    eslint: {
        config: {
            stylistic: {
                indent: 4,
                quotes: 'single',
                semi: false,
            },
        },
    },

    icon: {
        provider: 'server',
        fallbackToApi: false,
        serverBundle: {
            collections: ['lucide'],
        },
        clientBundle: {
            scan: true,
        },
    },
})
