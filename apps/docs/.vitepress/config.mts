// Sitio público de documentación de ArgosIsp. El contenido vive en /docs (srcDir) para que los
// runbooks y guías que ya estaban en el repositorio sean páginas del sitio sin moverlos.
// Se publica en GitHub Pages con .github/workflows/docs.yml.
import { dirname, extname, join, normalize } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { generarAyuda } from './ayuda'
import { barraDe } from './barra'

const raiz = fileURLToPath(new URL('../../../docs', import.meta.url))
const paginasDelPanel = fileURLToPath(new URL('../../web/app/pages', import.meta.url))
const base = process.env.DOCS_BASE ?? '/argos-isp/'
const requerir = createRequire(import.meta.url)
const repo = 'https://github.com/HCDestroyer/argos-isp'

// Secciones con barra propia. Cada una es una carpeta de /docs con su index.md.
const secciones = [
    'guia',
    'tutoriales',
    'manual',
    'runbooks',
    'desarrolladores',
    'laboratorio',
    'importacion',
    'seguridad',
    'piloto',
] as const

export default defineConfig({
    lang: 'es-GT',
    title: 'ArgosIsp',
    description: 'Documentación y tutoriales de ArgosIsp: gestión, facturación y RADIUS para proveedores de internet.',
    srcDir: raiz,
    base,
    cleanUrls: true,
    lastUpdated: true,
    // Los .sql y otros adjuntos de /docs no son páginas.
    srcExclude: ['**/README.md'],
    markdown: {
        // Los runbooks usan marcadores como `<tu-dominio>` en el texto: sin HTML crudo, se muestran
        // tal cual en vez de romper el compilador de Vue.
        html: false,
        languageAlias: { routeros: 'bash', rsc: 'bash' },
        // Un enlace relativo a un archivo del repositorio fuera de /docs (código, .sql, .rsc) se
        // convierte en un enlace a GitHub: en el sitio no existe esa página.
        config(md) {
            // `{{ … }}` en el texto (formatos de docker, plantillas) no es una interpolación de Vue.
            for (const regla of ['text', 'code_inline'] as const) {
                const original = md.renderer.rules[regla]
                md.renderer.rules[regla] = (tokens, idx, options, env, self) => {
                    const html = original ? original(tokens, idx, options, env, self) : (tokens[idx]?.content ?? '')
                    return html.includes('{{') ? `<span v-pre>${html}</span>` : html
                }
            }
            const previo = md.renderer.rules.link_open
            md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
                const token = tokens[idx]
                const href = token?.attrGet('href')
                if (token && href && !/^([a-z]+:|#|\/)/i.test(href)) {
                    const [ruta = '', ancla] = href.split('#')
                    const destino = normalize(join('docs', dirname(String(env.relativePath ?? '')), ruta))
                    const ext = extname(ruta)
                    const esPagina = ext === '' || ext === '.md'
                    if (!destino.startsWith('docs/') || (!esPagina && !/\.(png|jpe?g|svg|gif|webp)$/i.test(ruta))) {
                        const tipo = ext === '' && !destino.startsWith('docs/') ? 'tree' : 'blob'
                        token.attrSet('href', `${repo}/${tipo}/main/${destino}${ancla ? `#${ancla}` : ''}`)
                    }
                }
                return previo ? previo(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
            }
        },
    },
    // El contenido está fuera del paquete (/docs no tiene node_modules): Vue se resuelve desde aquí.
    vite: {
        resolve: {
            alias: [
                { find: /^vue$/, replacement: requerir.resolve('vue') },
                { find: /^vue\/server-renderer$/, replacement: requerir.resolve('vue/server-renderer') },
            ],
        },
    },
    head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }]],
    buildEnd(sitio) {
        generarAyuda({ raiz, paginas: paginasDelPanel, salida: sitio.outDir, base })
    },
    themeConfig: {
        logo: '/logo.svg',
        nav: [
            { text: 'Primeros pasos', link: '/guia/' },
            { text: 'Tutoriales', link: '/tutoriales/' },
            { text: 'Manual del panel', link: '/manual/' },
            {
                text: 'Operación',
                items: [
                    { text: 'Instalar y operar el servidor', link: '/runbooks/' },
                    { text: 'Importar desde otro sistema', link: '/importacion/' },
                    { text: 'Laboratorio', link: '/laboratorio/' },
                    { text: 'Seguridad', link: '/seguridad/' },
                ],
            },
            { text: 'Desarrolladores', link: '/desarrolladores/' },
        ],
        sidebar: Object.fromEntries(secciones.map((s) => [`/${s}/`, barraDe(raiz, s)])),
        socialLinks: [{ icon: 'github', link: repo }],
        editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Proponer un cambio a esta página' },
        search: {
            provider: 'local',
            options: {
                translations: {
                    button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar en la documentación' },
                    modal: {
                        displayDetails: 'Mostrar detalles',
                        resetButtonTitle: 'Borrar búsqueda',
                        backButtonTitle: 'Cerrar',
                        noResultsText: 'Sin resultados para',
                        footer: { selectText: 'abrir', navigateText: 'moverse', closeText: 'cerrar' },
                    },
                },
            },
        },
        outline: { label: 'En esta página', level: [2, 3] },
        docFooter: { prev: 'Anterior', next: 'Siguiente' },
        lastUpdated: { text: 'Actualizado' },
        returnToTopLabel: 'Volver arriba',
        sidebarMenuLabel: 'Menú',
        darkModeSwitchLabel: 'Tema',
        lightModeSwitchTitle: 'Cambiar a claro',
        darkModeSwitchTitle: 'Cambiar a oscuro',
        langMenuLabel: 'Idioma',
        notFound: { title: 'Página no encontrada', quote: 'Esta página no existe o cambió de lugar.', linkText: 'Ir al inicio' },
        footer: { message: 'ArgosIsp · parte de la familia Horus', copyright: 'Licencia en el repositorio' },
    },
})
