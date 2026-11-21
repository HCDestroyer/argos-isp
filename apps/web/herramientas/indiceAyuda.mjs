// Índice de ayuda contextual del panel: ruta de pantalla → resumen del manual.
//
// Lee `docs/manual/**/*.md` (el frontmatter `pantallas:` dice a qué pantallas aplica cada página,
// con `#ancla` opcional a la sección) y escribe `app/utils/indiceAyuda.ts`, que el drawer de ayuda
// (`AyudaBoton`) muestra sin red. El panel se construye sin `docs/` (Dockerfile), por eso el índice
// se commitea; `tests/nuxt/indiceAyuda.test.ts` falla si quedó desfasado del manual.
//
// Uso: pnpm --filter @argosisp/web ayuda:indice
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

function archivos(dir) {
    return readdirSync(dir, { withFileTypes: true })
        .flatMap(e => (e.isDirectory() ? archivos(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []))
        .sort()
}

/** Igual que los anclas del sitio: minúsculas, sin acentos, guiones. */
export function slug(texto) {
    return texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

/** Texto plano de una línea de Markdown (sin negritas, código ni enlaces). */
function plano(texto) {
    return texto
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Primer párrafo de prosa (no tabla, lista, cita ni bloque de código) desde `desde`. */
function primerParrafo(lineas, desde) {
    const parrafo = []
    for (let i = desde; i < lineas.length; i++) {
        const linea = lineas[i]
        if (/^#{1,6}\s/.test(linea)) {
            if (parrafo.length) {
                break
            }
            continue
        }
        if (!linea.trim()) {
            if (parrafo.length) {
                break
            }
            continue
        }
        if (/^\s*([|>-]|\d+\.|```|:::|<)/.test(linea)) {
            if (parrafo.length) {
                break
            }
            continue
        }
        parrafo.push(linea)
    }
    const texto = plano(parrafo.join(' '))
    return texto.length > 420 ? `${texto.slice(0, 417).replace(/\s+\S*$/, '')}…` : texto
}

function leerPagina(archivo, MANUAL) {
    const texto = readFileSync(archivo, 'utf8')
    const frente = texto.match(/^---\n([\s\S]*?)\n---\n/)
    if (!frente) {
        return null
    }
    const pantallas = [...frente[1].matchAll(/^\s+-\s+(\S+)\s*$/gm)].map(m => m[1]).filter(p => p.startsWith('/'))
    if (!pantallas.length) {
        return null
    }
    const lineas = texto.slice(frente[0].length).split('\n')
    const iTitulo = lineas.findIndex(l => /^#\s/.test(l))
    const titulo = iTitulo >= 0 ? plano(lineas[iTitulo].replace(/^#\s+/, '')) : relative(MANUAL, archivo)
    const encabezados = lineas
        .map((linea, indice) => ({ linea, indice }))
        .filter(({ linea }) => /^#{2,3}\s/.test(linea))
        .map(({ linea, indice }) => ({ nivel: linea.startsWith('###') ? 3 : 2, texto: plano(linea.replace(/^#+\s+/, '')), indice }))
    return {
        pagina: relative(MANUAL, archivo).replace(/\.md$/, '').replace(/\/index$/, ''),
        titulo,
        resumen: primerParrafo(lineas, iTitulo + 1),
        pantallas,
        encabezados,
        lineas,
    }
}

/** Literal de TS con el estilo del repo (comillas simples, 4 espacios, coma final). */
function aTs(valor, nivel) {
    const sangria = ' '.repeat((nivel + 1) * 4)
    const cierre = ' '.repeat(nivel * 4)
    if (valor === null) {
        return 'null'
    }
    if (typeof valor === 'string') {
        return `'${valor.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
    }
    if (Array.isArray(valor)) {
        return valor.length ? `[\n${valor.map(v => `${sangria}${aTs(v, nivel + 1)},`).join('\n')}\n${cierre}]` : '[]'
    }
    const claves = Object.entries(valor)
    return `{\n${claves.map(([k, v]) => `${sangria}${/^[a-z_]+$/.test(k) ? k : `'${k}'`}: ${aTs(v, nivel + 1)},`).join('\n')}\n${cierre}}`
}

/** Contenido de `app/utils/indiceAyuda.ts`; `web` es la carpeta de `apps/web`. */
export function generarIndiceAyuda(web) {
    const MANUAL = join(web, '../../docs/manual')
    const indice = {}
    for (const archivo of archivos(MANUAL)) {
        const pagina = leerPagina(archivo, MANUAL)
        if (!pagina) {
            continue
        }
        for (const pantalla of pagina.pantallas) {
            const [clave, ancla] = pantalla.split('#')
            const seccion = ancla ? pagina.encabezados.find(e => slug(e.texto) === ancla) : undefined
            // Secciones de primer nivel de la página (o las de la sección de la pantalla).
            const desde = seccion ? seccion.indice : -1
            const hasta = seccion
                ? (pagina.encabezados.find(e => e.indice > seccion.indice && e.nivel <= seccion.nivel)?.indice ?? Infinity)
                : Infinity
            const nivel = seccion ? seccion.nivel + 1 : 2
            const temas = pagina.encabezados
                .filter(e => e.indice > desde && e.indice < hasta && e.nivel === nivel)
                .map(e => e.texto)
                .slice(0, 8)
            if (indice[clave]) {
                continue
            }
            indice[clave] = {
                titulo: seccion ? `${pagina.titulo} · ${seccion.texto}` : pagina.titulo,
                resumen: (seccion ? primerParrafo(pagina.lineas, seccion.indice + 1) : '') || pagina.resumen,
                pagina: pagina.pagina,
                ancla: seccion ? ancla : null,
                temas,
            }
        }
    }
    const ordenado = Object.fromEntries(Object.entries(indice).sort(([a], [b]) => a.localeCompare(b)))
    return `// Generado por herramientas/indiceAyuda.mjs desde docs/manual: no editar a mano
// (pnpm --filter @argosisp/web ayuda:indice).

export interface EntradaAyuda {
    titulo: string
    resumen: string
    /** Página del manual (\`clientes-y-servicios/clientes\`). */
    pagina: string
    ancla: string | null
    /** Secciones de esa página (o de su sección) para «En el manual». */
    temas: string[]
}

export const INDICE_AYUDA: Record<string, EntradaAyuda> = ${aTs(ordenado, 0)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const web = fileURLToPath(new URL('..', import.meta.url))
    const salida = join(web, 'app/utils/indiceAyuda.ts')
    writeFileSync(salida, generarIndiceAyuda(web))
    console.log(`Índice de ayuda escrito en ${relative(web, salida)}`)
}
