import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { NoEncontrado } from '#shared/errores'

/**
 * Archivos de los comprobantes de depósito. Viven en el disco local (`COMPROBANTES_DIR`, por
 * defecto `apps/api/storage/comprobantes`), nunca en la base: la fila guarda la ruta relativa
 * (`2026/10/<uuid>.jpg`), el tipo y el tamaño.
 *
 * El tipo se decide por los primeros bytes del contenido (firma), no por la extensión ni por el
 * `Content-Type` que mande el navegador. Solo se aceptan fotos JPG, PNG o WebP y PDF.
 */

export const TAMANO_MAXIMO_COMPROBANTE = 5 * 1024 * 1024

export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number]

const EXTENSIONES: Record<TipoComprobante, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
}

function empiezaCon(contenido: Uint8Array, firma: number[], desde = 0): boolean {
    if (contenido.length < desde + firma.length) return false
    return firma.every((byte, i) => contenido[desde + i] === byte)
}

const ascii = (texto: string) => [...texto].map((c) => c.charCodeAt(0))

/** Tipo del archivo por su firma; null si no es JPG, PNG, WebP ni PDF. */
export function detectarTipoComprobante(contenido: Uint8Array): TipoComprobante | null {
    if (empiezaCon(contenido, [0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (empiezaCon(contenido, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
    if (empiezaCon(contenido, ascii('RIFF')) && empiezaCon(contenido, ascii('WEBP'), 8)) return 'image/webp'
    if (empiezaCon(contenido, ascii('%PDF-'))) return 'application/pdf'
    return null
}

export function extensionComprobante(tipo: TipoComprobante): string {
    return EXTENSIONES[tipo]
}

/** Carpeta raíz de los comprobantes (absoluta). */
export function directorioComprobantes(): string {
    const configurado = env.get('COMPROBANTES_DIR')
    if (!configurado) return app.makePath('storage', 'comprobantes')
    return isAbsolute(configurado) ? configurado : app.makePath(configurado)
}

/** Ruta relativa nueva para un comprobante: `AAAA/MM/<uuid>.<ext>`. */
export function nuevaRutaComprobante(tipo: TipoComprobante, ahora = new Date()): string {
    const anio = String(ahora.getUTCFullYear())
    const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0')
    return `${anio}/${mes}/${randomUUID()}.${extensionComprobante(tipo)}`
}

/** Ruta absoluta dentro de la carpeta; rechaza rutas que salgan de ella. */
function absoluta(ruta: string): string {
    const raiz = resolve(directorioComprobantes())
    const destino = resolve(raiz, ruta)
    const rel = relative(raiz, destino)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new NoEncontrado('El archivo del comprobante no existe')
    }
    return destino
}

/** Escribe el archivo (falla si ya existe: las rutas son únicas). */
export async function guardarArchivoComprobante(ruta: string, contenido: Uint8Array): Promise<void> {
    const destino = absoluta(ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, { flag: 'wx' })
}

export async function leerArchivoComprobante(ruta: string): Promise<Buffer> {
    try {
        return await readFile(absoluta(ruta))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NoEncontrado('El archivo del comprobante no está en el almacenamiento')
        }
        throw error
    }
}

/** Borra un archivo que quedó huérfano (la transacción que lo registraba falló). */
export async function borrarArchivoComprobante(ruta: string): Promise<void> {
    await rm(absoluta(ruta), { force: true })
}
