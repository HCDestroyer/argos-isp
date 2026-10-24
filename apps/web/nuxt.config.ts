import { permisosContrato } from './build/permisosContrato'

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
            meta: [
                { name: 'description', content: 'Panel de administración de ArgosIsp' },
                // Color de la barra del navegador en el teléfono: el fondo de cada tema.
                { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
                { name: 'theme-color', content: '#0b1014', media: '(prefers-color-scheme: dark)' },
            ],
            link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
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

    // Dependencias que Vite descubría tarde en `nuxt dev`: al pedir la primera página las
    // optimizaba y recargaba la pestaña a mitad de la carga (con el servidor en frío, la primera
    // prueba de Playwright podía perder el login; la otra causa, la compilación en frío, la cubre
    // `tests/e2e/calentar.ts`). Declaradas aquí, se empaquetan al arrancar.
    // `openapi-fetch` llega por `@argosisp/contracts` (paquete del workspace, que Vite no recorre).
    vite: {
        // Catálogo de permisos de los fixtures, derivado del OpenAPI (`build/permisosContrato.ts`).
        plugins: [permisosContrato()],
        optimizeDeps: {
            include: ['decimal.js', 'zod', '@argosisp/contracts > openapi-fetch'],
        },
    },

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
