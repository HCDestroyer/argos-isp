// Portal del cliente y página de corte de ArgosIsp. Móvil primero.
// Debe cargar dentro del walled garden: sin Google Fonts, sin Iconify remoto, sin CDNs.
// Todo (JS, CSS, iconos) sale de este mismo servidor Nitro en el puerto 3001.
export default defineNuxtConfig({
    modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxt/test-utils/module'],

    devtools: { enabled: false },

    app: {
        head: {
            htmlAttrs: { lang: 'es' },
            // `viewport-fit=cover`: la barra inferior del cliente usa `env(safe-area-inset-*)` (iPhone).
            viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
            title: 'Portal del cliente',
            meta: [
                { name: 'description', content: 'Portal del cliente: estado del servicio y pagos' },
                // Fondo de cada tema (identidad "vidrio y luz"): la barra del navegador se funde con la página.
                { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
                { name: 'theme-color', content: '#0b1014', media: '(prefers-color-scheme: dark)' },
                { name: 'mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-capable', content: 'yes' },
            ],
            // Marca de ArgosIsp (`public/favicon.svg`, misma figura que `LogoArgos`). Se sirve también
            // con Host ajeno (portal cautivo, `RECURSOS_EXACTOS`).
            link: [
                { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
                // PWA (sin service worker): `server/routes/manifest.webmanifest.get.ts` e `iconos/`.
                // `key`: con sesión, `/cuenta` lo cambia a `?empresa=<principal>` (multiempresa).
                { rel: 'manifest', href: '/manifest.webmanifest', key: 'manifest' },
                { rel: 'apple-touch-icon', href: '/iconos/apple-touch-icon.png' },
            ],
        },
    },

    css: ['~/assets/css/main.css'],

    ui: {
        // Sin @nuxt/fonts: nada de descargas a fonts.googleapis.com / fonts.gstatic.com.
        fonts: false,
    },

    runtimeConfig: {
        // NUXT_API_BASE_INTERNAL: apps/api vista desde el servidor Nitro (sin ruta), p. ej. http://api:3333.
        // El navegador nunca la ve: llama a /api/v1/portal/** en este mismo origen y Nitro reenvía
        // (server/api/v1/portal/[...ruta].ts) con X-Forwarded-For.
        apiBaseInternal: 'http://localhost:3333',
        // NUXT_NODO_PORTAL_TOKEN: token `argn_…` de un nodo portal remoto que llama a la API central sin
        // proxy de salida (contrato nodo-portal.md). Vacío = como siempre (portal junto a la API, o nodo
        // con el Caddy del instalador, que pone él el token). Con token, la API debe ir por HTTPS y este
        // servidor manda X-Argos-Nodo-Token y la IP del cliente en X-Argos-Cliente-Ip.
        nodoPortalToken: '',
        // Portal cautivo (server/middleware/portal-cautivo.ts). Peticiones con otro Host (dst-nat del
        // MikroTik) y las rutas de detección de los sistemas operativos se redirigen a /corte.
        portal: {
            // NUXT_PORTAL_URL_PUBLICA, p. ej. http://portal.argosisp.example (vacía = redirección relativa)
            urlPublica: '',
            // NUXT_PORTAL_HOSTS: otros nombres o IPs del portal, separados por coma (p. ej. 192.0.2.20)
            hosts: '',
            // NUXT_PORTAL_PROXIES_CONFIABLES: IPs/CIDR del proxy local delante de este servidor (Caddy).
            // De ellos se cree X-Forwarded-Proto (y, con token de nodo, X-Forwarded-For). Vacío = el socket.
            proxiesConfiables: '',
        },
        public: {
            // NUXT_PUBLIC_API_BASE vacío (recomendado) = mismo origen, a través del proxy de Nitro.
            // Con una URL, el navegador llama a la API directo (requiere CORS y que la API esté en el walled garden).
            apiBase: '',
            // NUXT_PUBLIC_SEGUIR_NAVEGANDO_URL: a dónde lleva "Seguir navegando" cuando el servicio se
            // reactiva en /corte. Ya con servicio, no necesita estar en el walled garden. Mejor HTTP:
            // así el sistema operativo vuelve a probar la conexión y cierra el aviso de portal cautivo.
            seguirNavegandoUrl: 'http://example.com/',
            // NUXT_PUBLIC_USE_FIXTURES=true responde desde apps/portal/fixtures sin backend.
            useFixtures: false,
            empresa: {
                // NUXT_PUBLIC_EMPRESA_NOMBRE: solo mientras carga GET /portal/empresa. Contacto,
                // instrucciones de pago y cuentas de depósito se configuran en el panel (tarea 9).
                nombre: 'ArgosIsp',
            },
        },
    },

    compatibilityDate: '2026-10-01',

    typescript: {
        strict: true,
        typeCheck: false,
        // Pruebas contra el servidor de producción (entorno node, vitest.servidor.config.ts).
        nodeTsConfig: {
            include: ['../tests/servidor/**/*', '../vitest.servidor.config.ts'],
        },
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
