#!/usr/bin/env node
/**
 * Genera las capturas de relleno en public/capturas/<archivo>.png a partir de
 * la composición "Relleno-<id>" (src/relleno/CapturaRelleno.tsx), al doble de
 * resolución (como una captura retina real).
 *
 * Por defecto NO sobrescribe una captura existente, para no pisar las reales.
 * Usa --forzar para regenerarlas todas.
 *
 * Uso: node scripts/generar-capturas.mjs [--forzar]   (o pnpm capturas:relleno)
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURAS } from '../src/guion.ts'
import { RAIZ, empaquetar, remotion } from './remotion.mjs'

const forzar = process.argv.includes('--forzar')
const destino = join(RAIZ, 'public', 'capturas')
mkdirSync(destino, { recursive: true })

const pendientes = Object.entries(CAPTURAS).filter(([, c]) => forzar || !existsSync(join(destino, c.archivo)))
if (pendientes.length === 0) {
    console.log('Todas las capturas existen. Usa --forzar para regenerar las de relleno.')
    process.exit(0)
}

const bundle = empaquetar()
for (const [id, captura] of pendientes) {
    remotion(['still', bundle, `Relleno-${id}`, join(destino, captura.archivo), '--scale=2', '--image-format=png', '--log', 'error'])
    console.log(`✓ ${captura.archivo} (${captura.ancho}×${captura.alto} @2x)`)
}
