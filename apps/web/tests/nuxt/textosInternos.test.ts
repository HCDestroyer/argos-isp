import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * El panel no habla de cómo se construye: nada de agentes (A1…A6), el PM, fases, PRs, contratos,
 * «decisión del…», «aún no implementado» ni «llega en…» en el texto que ve el usuario (plantillas,
 * etiquetas, ayudas, avisos y errores). Los comentarios de código sí pueden decirlo.
 *
 * Se revisa el `<template>` de cada `.vue` (sin `<!-- -->`) y las cadenas del `<script>` y de los
 * `.ts` de `app/` (sin comentarios `//` ni `/* *\/`).
 */
const PATRONES: { nombre: string, patron: RegExp }[] = [
    { nombre: 'agente entre paréntesis', patron: /\(A[1-6]\)/ },
    { nombre: 'agente', patron: /\b(?:agente|de|del|por|a|lo hace) A[1-6]\b/ },
    { nombre: 'PM', patron: /\bPM\b/ },
    { nombre: 'fase', patron: /\b[Ff]ase \d|\botra fase\b/ },
    { nombre: 'semana', patron: /\b[Ss]emana \d/ },
    { nombre: 'PR', patron: /\bPRs?\b/ },
    { nombre: 'contrato interno', patron: /contratos\/|\bcontrato (?:de integración|de eventos|§)|§\d/ },
    { nombre: 'decisión del…', patron: /[Dd]ecisi[oó]n del\b/ },
    { nombre: 'no implementado', patron: /no (?:est[aá] )?implementad|todav[ií]a no implementa/ },
    { nombre: 'llega en…', patron: /\b[Ll]lega(?:rá)? en (?:la )?(?:fase|semana|PR|A\d|otra)/ },
    { nombre: 'backend / endpoint', patron: /\bbackend\b|\bendpoint\b/ },
    { nombre: 'marca de trabajo', patron: /\b(?:NEEDS|TODO|FIXME)\b/ },
]

/** Las pruebas corren desde apps/web (`pnpm --filter @argosisp/web test`). */
const RAIZ = join(process.cwd(), 'app')

function archivos(directorio: string): string[] {
    return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
        const ruta = join(directorio, entrada.name)
        if (entrada.isDirectory()) {
            return archivos(ruta)
        }
        return /\.(vue|ts)$/.test(entrada.name) ? [ruta] : []
    })
}

/** Borra comentarios `//` y `/* *\/` respetando las cadenas; conserva los saltos de línea. */
function sinComentarios(codigo: string): string {
    let salida = ''
    let cadena: string | null = null
    for (let i = 0; i < codigo.length; i++) {
        const c = codigo[i]!
        const siguiente = codigo[i + 1]
        if (cadena) {
            salida += c
            if (c === '\\') {
                salida += siguiente ?? ''
                i++
            }
            else if (c === cadena) {
                cadena = null
            }
            continue
        }
        if (c === '"' || c === '\'' || c === '`') {
            cadena = c
            salida += c
            continue
        }
        if (c === '/' && siguiente === '*') {
            const fin = codigo.indexOf('*/', i + 2)
            const trozo = codigo.slice(i, fin === -1 ? codigo.length : fin + 2)
            salida += trozo.replace(/[^\n]/g, ' ')
            i += trozo.length - 1
            continue
        }
        if (c === '/' && siguiente === '/') {
            const fin = codigo.indexOf('\n', i)
            i = (fin === -1 ? codigo.length : fin) - 1
            continue
        }
        salida += c
    }
    return salida
}

/** Solo el contenido de las cadenas de cada línea (lo que puede llegar a la pantalla). */
function soloCadenas(codigo: string): string {
    return codigo.split('\n')
        .map(linea => (linea.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? []).join(' '))
        .join('\n')
}

function textoVisible(ruta: string, fuente: string): string {
    if (!ruta.endsWith('.vue')) {
        return soloCadenas(sinComentarios(fuente))
    }
    const plantilla = fuente.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
    const guion = fuente.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
    const sinHtml = plantilla.replace(/<!--[\s\S]*?-->/g, comentario => comentario.replace(/[^\n]/g, ' '))
    return `${sinHtml}\n${soloCadenas(sinComentarios(guion))}`
}

function hallazgos(ruta: string, fuente: string): string[] {
    const encontrados: string[] = []
    textoVisible(ruta, fuente).split('\n').forEach((linea) => {
        for (const { nombre, patron } of PATRONES) {
            const coincidencia = linea.match(patron)
            if (coincidencia) {
                encontrados.push(`${ruta}: ${nombre} «${coincidencia[0]}» en: ${linea.trim().slice(0, 160)}`)
            }
        }
    })
    return encontrados
}

describe('texto visible del panel sin notas internas', () => {
    it('ningún texto de app/ menciona agentes, PM, fases, PRs ni pendientes internos', () => {
        const todos = archivos(RAIZ).flatMap(ruta => hallazgos(relative(RAIZ, ruta), readFileSync(ruta, 'utf8')))
        expect(todos).toEqual([])
    })

    it('el detector encuentra los patrones en la plantilla y en las cadenas, no en los comentarios', () => {
        const vue = [
            '<script setup lang="ts">',
            '// Lo pidió el PM en la fase 4 (A6).',
            'const ayuda = \'Los formatos los convierte el adaptador (A6).\'',
            '</script>',
            '<template>',
            '    <!-- decisión del PM -->',
            '    <UAlert description="Llega en la fase 5" />',
            '    <p>Listo</p>',
            '</template>',
        ].join('\n')
        const encontrados = hallazgos('Prueba.vue', vue)
        expect(encontrados.some(h => h.includes('(A6)'))).toBe(true)
        expect(encontrados.some(h => h.includes('Llega en la fase'))).toBe(true)
        expect(encontrados.some(h => h.includes('decisión del PM'))).toBe(false)
        expect(encontrados.some(h => h.includes('Lo pidió el PM'))).toBe(false)
        expect(hallazgos('util.ts', '/** fase 4, A1 */\nexport const x = \'Sin datos\' // PM')).toEqual([])
    })
})
