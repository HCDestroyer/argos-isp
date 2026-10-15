// Portal del cliente y página de corte de ArgosIsp. Móvil primero.
// Debe cargar dentro del walled garden: sin Google Fonts, sin Iconify remoto, sin CDNs.
// Todo (JS, CSS, iconos) sale de este mismo servidor Nitro en el puerto 3001.
export default defineNuxtConfig({
    modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxt/test-utils/module'],

    devtools: { enabled: false },

    app: {
        head: {
            htmlAttrs: { lang: 'es' },
            title: 'Portal del cliente',
            meta: [
                { name: 'description', content: 'Portal del cliente: estado del servicio y pagos' },
                { name: 'theme-color', content: '#0284c7' },
            ],
        },
    },

    css: ['~/assets/css/main.css'],

    ui: {
        // Sin @nuxt/fonts: nada de descargas a fonts.googleapis.com / fonts.gstatic.com.
        fonts: false,
    },

    runtimeConfig: {
        public: {
            // NUXT_PUBLIC_API_BASE
            apiBase: 'http://localhost:3333',
            // NUXT_PUBLIC_USE_FIXTURES=true responde desde apps/portal/fixtures sin backend.
            useFixtures: false,
            empresa: {
                // NUXT_PUBLIC_EMPRESA_NOMBRE, NUXT_PUBLIC_EMPRESA_TELEFONO
                nombre: 'ArgosIsp',
                telefono: '',
            },
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

    // Iconos lucide empaquetados (cliente) y servidos por este mismo servidor; nunca api.iconify.design.
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
