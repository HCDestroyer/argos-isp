// Puente entre el botón «Ayuda» del panel y el manual.
//
// Cada página del manual declara en su frontmatter las pantallas del panel que explica:
//
//     pantallas:
//         - /clientes
//         - /clientes/[id]#ficha        (opcional: ancla dentro de la página)
//
// La clave de una pantalla es la ruta de su archivo en apps/web/app/pages, sin `.vue` ni `/index`
// (`clientes/[id]/editar.vue` → `/clientes/[id]/editar`). El panel abre
// `<sitio>/ayuda/?pantalla=<clave>` y esta página redirige a la sección que la explica.
//
// Al compilar se comprueba que todas las pantallas del panel tengan su ayuda. Con
// DOCS_AYUDA_ESTRICTA=1 (CI) una pantalla sin ayuda falla la compilación; sin la variable, avisa.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Pantallas que no necesitan ayuda propia (no son pantallas de trabajo). */
const SIN_AYUDA = new Set(['/login', '/sin-permiso', '/sso/entrar'])

function archivos(dir: string, ext: string): string[] {
    const salida: string[] = []
    for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre)
        if (statSync(ruta).isDirectory()) {
            if (nombre !== 'public' && !nombre.startsWith('.')) salida.push(...archivos(ruta, ext))
        } else if (nombre.endsWith(ext)) {
            salida.push(ruta)
        }
    }
    return salida
}

/** Claves de todas las pantallas del panel, desde los archivos de apps/web/app/pages. */
export function pantallasDelPanel(paginas: string): string[] {
    return archivos(paginas, '.vue')
        .map((f) => {
            const clave = `/${relative(paginas, f).replace(/\.vue$/, '').replace(/(^|\/)index$/, '')}`
            return clave === '/' ? '/' : clave.replace(/\/$/, '')
        })
        .filter((c) => !SIN_AYUDA.has(c))
        .sort()
}

/** Mapa pantalla → URL de la página del manual (con ancla), desde el frontmatter de /docs. */
export function mapaDeAyuda(raiz: string): Map<string, string> {
    const mapa = new Map<string, string>()
    for (const f of archivos(raiz, '.md')) {
        const texto = readFileSync(f, 'utf8')
        const frente = /^---\n([\s\S]*?)\n---/.exec(texto)?.[1]
        if (!frente) continue
        const bloque = /^pantallas:\s*\n((?:\s+-\s+.+\n?)+)/m.exec(frente)?.[1]
        if (!bloque) continue
        const pagina = `/${relative(raiz, f).replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')}`
        for (const linea of bloque.split('\n')) {
            const valor = /^\s+-\s+(.+)$/.exec(linea)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
            if (!valor) continue
            const [clave = '', ancla] = valor.split('#')
            const previo = mapa.get(clave)
            if (previo) throw new Error(`La pantalla ${clave} tiene dos páginas de ayuda: ${previo} y ${pagina}`)
            mapa.set(clave, ancla ? `${pagina}#${ancla}` : pagina)
        }
    }
    return mapa
}

/** Comprueba la cobertura y escribe /ayuda/index.html en el sitio compilado. */
export function generarAyuda(opciones: { raiz: string; paginas: string; salida: string; base: string }): void {
    const mapa = mapaDeAyuda(opciones.raiz)
    const pantallas = pantallasDelPanel(opciones.paginas)
    const faltan = pantallas.filter((p) => !mapa.has(p))
    const sobran = [...mapa.keys()].filter((p) => !pantallas.includes(p) && !SIN_AYUDA.has(p))
    const problemas = [
        ...faltan.map((p) => `sin ayuda: ${p}`),
        ...sobran.map((p) => `la pantalla ${p} no existe en apps/web/app/pages`),
    ]
    if (problemas.length) {
        const texto = `Ayuda del panel:\n  ${problemas.join('\n  ')}`
        if (process.env.DOCS_AYUDA_ESTRICTA === '1') throw new Error(texto)
        console.warn(`\n${texto}\n`)
    }
    const destinos = Object.fromEntries([...mapa].map(([clave, url]) => [clave, `${opciones.base}${url.replace(/^\//, '')}`]))
    const html = `<!doctype html>
<html lang="es-GT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ayuda · ArgosIsp</title>
<script>
(function () {
    var destinos = ${JSON.stringify(destinos)};
    var pantalla = new URLSearchParams(location.search).get('pantalla') || '';
    location.replace(destinos[pantalla] || ${JSON.stringify(`${opciones.base}manual/`)});
})();
</script>
</head>
<body><p>Abriendo la ayuda… Si no abre, <a href="${opciones.base}manual/">ve al manual del panel</a>.</p></body>
</html>
`
    mkdirSync(join(opciones.salida, 'ayuda'), { recursive: true })
    writeFileSync(join(opciones.salida, 'ayuda', 'index.html'), html)
}
