import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { directorioComprobantes } from '#billing/comprobantes_archivos'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'

/**
 * Imagen de un anuncio. Mismo almacenamiento que los comprobantes y los logos (disco en
 * `COMPROBANTES_DIR`, subcarpeta `anuncios/`), nunca en la base. Solo PNG, JPEG o WebP, decididos
 * por la firma del archivo (no por el nombre ni el `Content-Type`), hasta 1 MB y de 64 a 4096 px
 * por lado. Se guarda su tamaño para que el portal la pinte con `width`/`height` fijos (sin saltos
 * de diseño) y `loading="lazy"`. Sin SVG: un anuncio no necesita vectores y así no hay nada que sanear.
 */

export const TAMANO_MAXIMO_IMAGEN = 1024 * 1024
export const LADO_MINIMO = 64
export const LADO_MAXIMO = 4096

export type TipoImagenAnuncio = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImagenPreparada {
    contenido: Buffer
    tipo: TipoImagenAnuncio
    etag: string
    ancho: number
    alto: number
}

function error(message: string, rule: string): ValidacionFallida {
    return new ValidacionFallida([{ field: 'imagen', message, rule }])
}

function dimensionesPng(b: Buffer): [number, number] | null {
    const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (b.length < 24 || !firma.every((byte, i) => b[i] === byte)) return null
    if (b.toString('latin1', 12, 16) !== 'IHDR') return null
    return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

function dimensionesJpeg(b: Buffer): [number, number] | null {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
    let i = 2
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const marca = b[i + 1]!
        if (marca === 0xff) {
            i += 1
            continue
        }
        const largo = b.readUInt16BE(i + 2)
        // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC)
        if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
            return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
        }
        if (largo < 2) return null
        i += 2 + largo
    }
    return null
}

function dimensionesWebp(b: Buffer): [number, number] | null {
    if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') {
        return null
    }
    const trozo = b.toString('latin1', 12, 16)
    if (trozo === 'VP8 ') {
        return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    }
    if (trozo === 'VP8L') {
        const bits = b.readUInt32LE(21)
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
    }
    if (trozo === 'VP8X') {
        return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1]
    }
    return null
}

/** Valida el archivo subido. 422 en `imagen` si no es PNG, JPEG o WebP legible o se pasa de tamaño. */
export function prepararImagenAnuncio(contenido: Uint8Array): ImagenPreparada {
    if (contenido.length === 0) throw error('Falta el archivo de la imagen', 'required')
    if (contenido.length > TAMANO_MAXIMO_IMAGEN) {
        throw error(`La imagen pesa ${Math.ceil(contenido.length / 1024)} KB; el máximo es 1024 KB`, 'tamano')
    }
    const b = Buffer.from(contenido)
    const candidatos: Array<[TipoImagenAnuncio, [number, number] | null]> = [
        ['image/png', dimensionesPng(b)],
        ['image/jpeg', dimensionesJpeg(b)],
        ['image/webp', dimensionesWebp(b)],
    ]
    const hallado = candidatos.find(([, d]) => d !== null)
    if (!hallado) throw error('La imagen debe ser PNG, JPEG o WebP', 'tipo')
    const [tipo, [ancho, alto]] = hallado as [TipoImagenAnuncio, [number, number]]
    if (ancho < LADO_MINIMO || alto < LADO_MINIMO || ancho > LADO_MAXIMO || alto > LADO_MAXIMO) {
        throw error(
            `La imagen mide ${ancho}×${alto} px; cada lado debe medir entre ${LADO_MINIMO} y ${LADO_MAXIMO} px`,
            'dimensiones',
        )
    }
    return { contenido: b, tipo, etag: createHash('sha256').update(b).digest('hex'), ancho, alto }
}

const EXTENSION: Record<TipoImagenAnuncio, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
}

export function directorioAnuncios(): string {
    return join(directorioComprobantes(), 'anuncios')
}

export function nuevaRutaImagen(empresaId: number, tipo: TipoImagenAnuncio): string {
    return `empresas/${empresaId}/${randomUUID()}.${EXTENSION[tipo]}`
}

function absoluta(ruta: string): string {
    const raiz = resolve(directorioAnuncios())
    const destino = resolve(raiz, ruta)
    const rel = relative(raiz, destino)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new NoEncontrado('La imagen no existe')
    }
    return destino
}

export async function guardarImagenAnuncio(ruta: string, contenido: Uint8Array): Promise<void> {
    const destino = absoluta(ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, { flag: 'wx' })
}

export async function leerImagenAnuncio(ruta: string): Promise<Buffer> {
    try {
        return await readFile(absoluta(ruta))
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NoEncontrado('La imagen no está guardada')
        }
        throw e
    }
}

export async function borrarImagenAnuncio(ruta: string): Promise<void> {
    await rm(absoluta(ruta), { force: true })
}
