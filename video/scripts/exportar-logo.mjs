#!/usr/bin/env node
/**
 * Exporta el símbolo elegido (src/logo/geometria.ts → LOGO_ELEGIDO) a
 * public/logo-argos.svg, en trazos cian (#22d3ee) sobre transparente, y una
 * versión monocroma con currentColor en public/logo-argos-mono.svg para usar
 * en la web o en documentos.
 *
 * Uso: node scripts/exportar-logo.mjs   (o pnpm logo)
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGO_ELEGIDO, svgEstatico } from '../src/logo/geometria.ts'
import { RAIZ } from './remotion.mjs'

const salidas = {
    'logo-argos.svg': svgEstatico(LOGO_ELEGIDO, { color: '#22d3ee', tamano: 512 }),
    'logo-argos-mono.svg': svgEstatico(LOGO_ELEGIDO, { color: 'currentColor', tamano: 64 }),
}
for (const [archivo, svg] of Object.entries(salidas)) {
    writeFileSync(join(RAIZ, 'public', archivo), svg)
    console.log(`✓ public/${archivo}`)
}
