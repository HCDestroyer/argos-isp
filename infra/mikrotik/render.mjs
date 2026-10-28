#!/usr/bin/env node
// Implementación de referencia del render de las plantillas de conexión (contratos/conexion-routers.md
// §3). La API (A1) hace lo mismo al servir GET /routers/:id/script-conexion:
//   - cada {{nombre}} de la plantilla se reemplaza por su valor;
//   - todos los nombres de la plantilla deben venir y cumplir su patrón de variables.json (si no,
//     error: nunca se sirve un script a medias);
//   - el valor va dentro de una cadena de RouterOS: se escapan \ " $ ? y se rechazan los caracteres
//     de control (un salto de línea cerraría la cadena).
//
// CLI (laboratorio):  node infra/mikrotik/render.mjs plantillas/conexion.rsc.tpl valores.json > r.rsc
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const VARIABLE = /\{\{([a-z0-9_]+)\}\}/g

export const VARIABLES = (() => {
    const v = JSON.parse(readFileSync(join(DIR, 'variables.json'), 'utf8'))
    return { ...v.conexion, ...v.servicio }
})()

/** Nombres que usa una plantilla, en orden de aparición y sin repetir. */
export function variablesDe(plantilla) {
    return [...new Set([...plantilla.matchAll(VARIABLE)].map((m) => m[1]))]
}

/** Escapa un valor para una cadena entre comillas de RouterOS. */
export function escapar(valor) {
    const texto = String(valor)
    if (/[\u0000-\u001f\u007f]/.test(texto)) {
        throw new Error('valor con caracteres de control')
    }
    return texto.replace(/[\\"$?]/g, (c) => `\\${c}`)
}

export function renderizar(plantilla, valores) {
    const errores = []
    for (const nombre of variablesDe(plantilla)) {
        const def = VARIABLES[nombre]
        const valor = valores[nombre]
        if (!def) {
            errores.push(`${nombre}: no está en variables.json`)
        } else if (valor === undefined || valor === null) {
            errores.push(`${nombre}: falta`)
        } else if (!new RegExp(def.patron).test(String(valor))) {
            errores.push(`${nombre}: no cumple ${def.patron}`)
        }
    }
    if (errores.length) {
        throw new Error(`plantilla de conexión: ${errores.join('; ')}`)
    }
    return plantilla.replace(VARIABLE, (_, nombre) => escapar(valores[nombre]))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [plantilla, valores] = process.argv.slice(2)
    if (!plantilla || !valores) {
        console.error('uso: node infra/mikrotik/render.mjs <plantilla.rsc.tpl> <valores.json>')
        process.exit(2)
    }
    process.stdout.write(
        renderizar(readFileSync(plantilla, 'utf8'), JSON.parse(readFileSync(valores, 'utf8'))),
    )
}
