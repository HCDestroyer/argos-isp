import { writeSync } from 'node:fs'
import { inspect } from 'node:util'
import type { PluginFn } from '@japa/runner/types'

/**
 * Rastreo de errores sin manejar en las pruebas (`unhandledRejection` y `uncaughtException`).
 *
 * Japa ya los atrapa y hace fallar la corrida (`process.exitCode = 1`), pero solo imprime dos líneas
 * de la pila y no dice en qué prueba ocurrieron; si llegan después del resumen (al cerrar la app),
 * salen sueltos al final de la salida. Este plugin no cambia eso: agrega su propio oyente que
 * escribe en stderr, en el momento, la pila completa (con `cause`) y dónde estaba la corrida:
 *
 * - `durante`: la prueba en curso (archivo › grupo › título).
 * - `entre pruebas`: ninguna en curso; la última que terminó (un efecto que la sobrevivió).
 * - `tras la suite`: ya terminaron todas (algo siguió corriendo mientras se cerraba la app).
 */

interface Posicion {
    archivo?: string
    grupo?: string
    prueba: string
}

let enCurso: Posicion | null = null
let ultima: Posicion | null = null
let grupo: string | undefined
let terminada = false
let registrado = false

function describir(p: Posicion | null): string {
    if (!p) return '(ninguna)'
    return [p.archivo, p.grupo, p.prueba].filter(Boolean).join(' › ')
}

/** Dónde estaba la corrida cuando llegó el error (exportada para sus pruebas). */
export function contextoActual(): string {
    if (enCurso) return `durante: ${describir(enCurso)}`
    if (terminada) return `tras la suite (cerrando la app); última prueba: ${describir(ultima)}`
    return `entre pruebas; última que terminó: ${describir(ultima)}`
}

/** Texto que se escribe en stderr (exportado para sus pruebas). */
export function reporteError(tipo: 'unhandledRejection' | 'uncaughtException', error: unknown): string {
    const detalle = inspect(error, { depth: 6, breakLength: 120 })
    return ['', `━━━━ [${tipo}] ━━━━`, contextoActual(), detalle, `━━━━ fin [${tipo}] ━━━━`, ''].join('\n')
}

function escribir(texto: string) {
    // síncrono: el proceso puede estar saliendo
    try {
        writeSync(2, `${texto}\n`)
    } catch {
        // stderr cerrado: Japa igual lo reporta
    }
}

export function rastrearRechazos(): PluginFn {
    return ({ emitter }) => {
        emitter.on('group:start', (g) => {
            grupo = g.title
        })
        emitter.on('group:end', () => {
            grupo = undefined
        })
        emitter.on('test:start', (t) => {
            const archivo = (t.meta as { fileName?: string }).fileName
            enCurso = { archivo, grupo, prueba: t.title.expanded }
        })
        emitter.on('test:end', () => {
            ultima = enCurso
            enCurso = null
        })
        emitter.on('runner:end', () => {
            terminada = true
        })
        if (registrado) return
        registrado = true
        process.on('unhandledRejection', (error) => escribir(reporteError('unhandledRejection', error)))
        process.on('uncaughtException', (error) => escribir(reporteError('uncaughtException', error)))
    }
}
