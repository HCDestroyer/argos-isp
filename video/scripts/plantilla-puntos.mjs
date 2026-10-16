#!/usr/bin/env node
/**
 * Escribe out/puntos-plantilla.json con todos los puntos de interés del guion
 * en el formato de public/capturas/puntos.json ({ archivo, x, y, etiqueta }).
 * Sirve de punto de partida para medir las capturas reales: corrige x, y (y
 * ancho/alto si cambian) y copia el resultado a public/capturas/puntos.json.
 *
 * Uso: node scripts/plantilla-puntos.mjs   (o pnpm puntos:plantilla)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { plantillaPuntos } from '../src/guion.ts'
import { RAIZ } from './remotion.mjs'

const destino = join(RAIZ, 'out', 'puntos-plantilla.json')
mkdirSync(join(RAIZ, 'out'), { recursive: true })
const puntos = plantillaPuntos()
writeFileSync(destino, `${JSON.stringify(puntos, null, 4)}\n`)
console.log(`✓ ${puntos.length} puntos en ${destino}`)
