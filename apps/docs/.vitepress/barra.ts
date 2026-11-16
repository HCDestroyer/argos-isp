// Barra lateral generada desde las carpetas de /docs, para que cada agente agregue páginas sin
// tocar un archivo compartido. Reglas:
//   - Cada archivo .md es una página; su título es el primer `# ` del archivo.
//   - `orden: <n>` en el frontmatter ordena (sin orden van al final, por título).
//   - Una subcarpeta es un grupo; su título y orden salen de su `index.md`.
//   - `barra: false` en el frontmatter oculta la página de la barra (sigue publicada).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DefaultTheme } from 'vitepress'

type Item = DefaultTheme.SidebarItem & { orden: number }

interface Meta {
    titulo: string
    orden: number
    oculta: boolean
}

function leerMeta(archivo: string, respaldo: string): Meta {
    const texto = readFileSync(archivo, 'utf8')
    let orden = Number.POSITIVE_INFINITY
    let oculta = false
    let titulo: string | undefined
    const frente = /^---\n([\s\S]*?)\n---/.exec(texto)
    if (frente?.[1]) {
        const o = /^orden:\s*(\d+)/m.exec(frente[1])
        if (o?.[1]) orden = Number(o[1])
        if (/^barra:\s*false/m.test(frente[1])) oculta = true
        const t = /^titulo_barra:\s*(.+)$/m.exec(frente[1])
        if (t?.[1]) titulo = t[1].trim().replace(/^['"]|['"]$/g, '')
    }
    if (!titulo) {
        const h1 = /^#\s+(.+)$/m.exec(texto.replace(/^---\n[\s\S]*?\n---/, ''))
        titulo = h1?.[1]?.trim() ?? respaldo
    }
    return { titulo, orden, oculta }
}

function ordenar(a: Item, b: Item): number {
    if (a.orden !== b.orden) return a.orden - b.orden
    return String(a.text).localeCompare(String(b.text), 'es')
}

function grupo(raiz: string, rel: string): Item[] {
    const dir = join(raiz, rel)
    const items: Item[] = []
    for (const nombre of readdirSync(dir)) {
        if (nombre.startsWith('.') || nombre === 'public' || nombre === 'img') continue
        const ruta = join(dir, nombre)
        const relHijo = rel ? `${rel}/${nombre}` : nombre
        if (statSync(ruta).isDirectory()) {
            const hijos = grupo(raiz, relHijo)
            let meta: Meta = { titulo: nombre, orden: Number.POSITIVE_INFINITY, oculta: false }
            try {
                meta = leerMeta(join(ruta, 'index.md'), nombre)
            } catch {
                // carpeta sin index.md: se usa el nombre
            }
            if (meta.oculta || hijos.length === 0) continue
            items.push({ text: meta.titulo, orden: meta.orden, collapsed: true, items: hijos })
        } else if (nombre.endsWith('.md') && nombre !== 'index.md') {
            const meta = leerMeta(ruta, nombre.replace(/\.md$/, ''))
            if (meta.oculta) continue
            items.push({ text: meta.titulo, orden: meta.orden, link: `/${relHijo.replace(/\.md$/, '')}` })
        }
    }
    return items.sort(ordenar)
}

/** Barra de una sección: su index.md arriba y luego las páginas y grupos de la carpeta. */
export function barraDe(raiz: string, seccion: string): DefaultTheme.SidebarItem[] {
    const meta = leerMeta(join(raiz, seccion, 'index.md'), seccion)
    const limpiar = (xs: Item[]): DefaultTheme.SidebarItem[] =>
        xs.map(({ orden: _orden, ...x }) => (x.items ? { ...x, items: limpiar(x.items as Item[]) } : x))
    return [
        {
            text: meta.titulo,
            items: [{ text: 'Introducción', link: `/${seccion}/` }, ...limpiar(grupo(raiz, seccion))],
        },
    ]
}
