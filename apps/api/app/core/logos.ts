import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { directorioComprobantes } from '#billing/comprobantes_archivos'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { SvgInvalido, sanearSvg } from '#core/svg'

/**
 * Logos de las empresas. Mismo almacenamiento que los comprobantes de depósito (A3): disco local
 * en `COMPROBANTES_DIR`, subcarpeta `logos/` (el mismo volumen persistente y respaldado), nunca en
 * la base. La fila guarda la ruta relativa (`empresas/<id>/<uuid>.png`), el tipo y el ETag
 * (sha256 del contenido).
 *
 * Solo PNG (por firma) o SVG saneado (`#core/svg`), hasta 512 KB.
 */

export const TAMANO_MAXIMO_LOGO = 512 * 1024

export type TipoLogo = 'image/png' | 'image/svg+xml'

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface LogoPreparado {
    contenido: Buffer
    tipo: TipoLogo
    etag: string
}

function errorLogo(message: string, rule: string): ValidacionFallida {
    return new ValidacionFallida([{ field: 'logo', message, rule }])
}

/**
 * Valida y normaliza el archivo subido: PNG por firma; si no, se intenta como SVG y se sanea
 * (scripts, eventos, estilos y referencias externas fuera). 422 en `logo` si no es ninguno.
 */
export function prepararLogo(contenido: Uint8Array): LogoPreparado {
    if (contenido.length === 0) throw errorLogo('Falta el archivo del logo', 'required')
    if (contenido.length > TAMANO_MAXIMO_LOGO) {
        throw errorLogo(
            `El logo pesa ${Math.ceil(contenido.length / 1024)} KB; el máximo es 512 KB`,
            'tamano',
        )
    }
    const buffer = Buffer.from(contenido)
    if (FIRMA_PNG.every((byte, i) => buffer[i] === byte)) {
        return { contenido: buffer, tipo: 'image/png', etag: huella(buffer) }
    }

    const texto = buffer.toString('utf8')
    if (!/<svg[\s>/]/i.test(texto)) throw errorLogo('El logo debe ser PNG o SVG', 'tipo')
    let saneado: string
    try {
        saneado = sanearSvg(texto)
    } catch (error) {
        if (error instanceof SvgInvalido) throw errorLogo(`El SVG no es válido: ${error.message}`, 'svg')
        throw error
    }
    const limpio = Buffer.from(saneado, 'utf8')
    return { contenido: limpio, tipo: 'image/svg+xml', etag: huella(limpio) }
}

function huella(contenido: Buffer): string {
    return createHash('sha256').update(contenido).digest('hex')
}

export function directorioLogos(): string {
    return join(directorioComprobantes(), 'logos')
}

export function nuevaRutaLogo(empresaId: number, tipo: TipoLogo): string {
    return `empresas/${empresaId}/${randomUUID()}.${tipo === 'image/png' ? 'png' : 'svg'}`
}

function absoluta(ruta: string): string {
    const raiz = resolve(directorioLogos())
    const destino = resolve(raiz, ruta)
    const rel = relative(raiz, destino)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new NoEncontrado('El logo no existe')
    }
    return destino
}

export async function guardarArchivoLogo(ruta: string, contenido: Uint8Array): Promise<void> {
    const destino = absoluta(ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, { flag: 'wx' })
}

export async function leerArchivoLogo(ruta: string): Promise<Buffer> {
    try {
        return await readFile(absoluta(ruta))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NoEncontrado('El logo no está en el almacenamiento')
        }
        throw error
    }
}

export async function borrarArchivoLogo(ruta: string): Promise<void> {
    await rm(absoluta(ruta), { force: true })
}
