#!/usr/bin/env node
/**
 * Renderiza stills de revisión del tour (portada, escenas intermedias y cierre)
 * en out/stills/ (o en --destino=<carpeta>).
 *
 * Uso: node scripts/generar-stills.mjs [--destino=<carpeta>] [--solo=portada,cierre]
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FPS, escenaPorId } from '../src/guion.ts'
import { RAIZ, empaquetar, remotion } from './remotion.mjs'

/** Nombre del still → escena y segundo dentro de ella. */
const STILLS = {
    portada: ['portada', 3.4],
    clientes: ['clientes', 3.8],
    'clientes-tabla': ['clientes', 7.2],
    'servicio-ips': ['servicio', 3.2],
    servicio: ['servicio', 6.0],
    'servicio-activo': ['servicio', 8.6],
    'cobro-dependiente': ['cobro', 3.4],
    cobro: ['cobro', 6.2],
    'cobro-transferencia': ['cobro', 7.8],
    'cobro-recibo': ['cobro', 12.6],
    diagrama: ['diagrama', 10.6],
    'montaje-caja': ['montaje', 2.4],
    'montaje-promesas': ['montaje', 4.9],
    'montaje-facturas': ['montaje', 7.5],
    montaje: ['montaje', 10.0],
    'montaje-bitacora': ['montaje', 12.6],
    'portal-corte': ['portal', 1.7],
    portal: ['portal', 4.2],
    'portal-cuenta': ['portal', 6.3],
    'portal-pdf': ['portal', 8.6],
    red: ['red', 5.4],
    cierre: ['cierre', 5.6],
}

const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const destino = resolve(arg('destino') ?? join(RAIZ, 'out', 'stills'))
const solo = arg('solo')?.split(',')
mkdirSync(destino, { recursive: true })

const bundle = empaquetar()
for (const [nombre, [id, segundo]] of Object.entries(STILLS)) {
    if (solo && !solo.includes(nombre)) continue
    const escena = escenaPorId(id)
    const frame = Math.min(escena.desde + Math.round(segundo * FPS), escena.desde + escena.frames - 1)
    remotion(['still', bundle, 'Tour', join(destino, `${nombre}.png`), `--frame=${frame}`, '--image-format=png', '--log', 'error'])
    console.log(`✓ ${nombre}.png (frame ${frame})`)
}
