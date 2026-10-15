#!/usr/bin/env node
// Falla si el panel o el portal piden un permiso que no existe en el catálogo del ACL
// (apps/api/app/core/permisos.ts). Evita errores como `caja.ver` frente a `cajas.ver`.
// Uso: pnpm verificar:permisos
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const raiz = new URL('..', import.meta.url).pathname
const catalogo = readFileSync(join(raiz, 'apps/api/app/core/permisos.ts'), 'utf8')
const bloque = catalogo.slice(catalogo.indexOf('export const PERMISOS'))
const existentes = new Set([...bloque.matchAll(/^\s+'([a-z0-9_]+\.[a-z0-9_.]+)':/gm)].map((m) => m[1]))
const declaradas = (bloque.slice(0, bloque.indexOf('\n}')).match(/^\s+'[^']+':/gm) ?? []).length
if (declaradas !== existentes.size) {
    console.error(`El catálogo declara ${declaradas} permisos pero se leyeron ${existentes.size}: revisa el patrón`)
    process.exit(2)
}
if (existentes.size === 0) {
    console.error('No se pudo leer el catálogo de permisos de apps/api/app/core/permisos.ts')
    process.exit(2)
}

function* archivos(dir) {
    for (const nombre of readdirSync(dir)) {
        if (['node_modules', '.nuxt', '.output', 'dist'].includes(nombre)) continue
        const ruta = join(dir, nombre)
        if (statSync(ruta).isDirectory()) yield* archivos(ruta)
        else if (/\.(vue|ts)$/.test(nombre)) yield ruta
    }
}

// Literales de permiso: `permiso: 'x.y'`, `puede('x.y')`, `puedeAlguno(['x.y', ...])`, `conPermiso('x.y')`.
const patrones = [
    /permiso:\s*'([a-z0-9_]+\.[a-z0-9_.]+)'/g,
    /(?:puede|conPermiso)\(\s*'([a-z0-9_]+\.[a-z0-9_.]+)'/g,
    /(?:puedeAlguno|puedeTodos)\(\s*\[([^\]]*)\]/g,
]
const errores = []
let revisados = 0
for (const app of ['apps/web', 'apps/portal']) {
    for (const archivo of archivos(join(raiz, app))) {
        const texto = readFileSync(archivo, 'utf8')
        for (const patron of patrones) {
            for (const m of texto.matchAll(patron)) {
                const nombres = m[1].includes("'")
                    ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
                    : [m[1]]
                for (const permiso of nombres) {
                    revisados++
                    if (!existentes.has(permiso)) {
                        const linea = texto.slice(0, m.index).split('\n').length
                        errores.push(`${relative(raiz, archivo)}:${linea}  permiso inexistente: ${permiso}`)
                    }
                }
            }
        }
    }
}
if (errores.length) {
    console.error(errores.join('\n'))
    console.error(`\n${errores.length} permiso(s) que no están en apps/api/app/core/permisos.ts`)
    process.exit(1)
}
console.log(
    `Permisos del frontend verificados: ${revisados} usos, todos existen en el catálogo (${existentes.size}).`,
)
