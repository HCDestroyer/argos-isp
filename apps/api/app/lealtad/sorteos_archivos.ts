import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { directorioComprobantes, detectarTipoComprobante } from '#billing/comprobantes_archivos'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import type { Transaccion } from '#shared/domain_action'

/**
 * Archivos de los sorteos (`lealtad.sorteos_archivos`, solo inserción): evidencias del checklist (§8),
 * imágenes de los premios, el acta (§7.3, punto 6) y las constancias de entrega (§7.4).
 *
 * Mismo almacenamiento que los comprobantes, los logos y las imágenes de los anuncios: disco en
 * `COMPROBANTES_DIR`, subcarpeta `sorteos/`, nunca en la base. El tipo se decide por la firma del
 * contenido, no por el nombre ni el `Content-Type`:
 *
 * - evidencias y constancias: PDF, JPEG, PNG o WebP, hasta 5 MB;
 * - imágenes de premios: PNG, JPEG o WebP, hasta 1 MB y de 64 a 4096 px por lado (las mismas reglas
 *   que las imágenes de los anuncios del portal), con su ancho y alto para pintarlas sin saltos;
 * - acta: el PDF que genera `sorteos.cerrar_acta`.
 */

export const USOS_ARCHIVO_SORTEO = ['evidencia', 'imagen_premio', 'acta', 'constancia'] as const
export type UsoArchivoSorteo = (typeof USOS_ARCHIVO_SORTEO)[number]

export const TAMANO_MAXIMO_EVIDENCIA = 5 * 1024 * 1024
export const TAMANO_MAXIMO_IMAGEN = 1024 * 1024
export const LADO_MINIMO = 64
export const LADO_MAXIMO = 4096

type TipoArchivo = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

const EXTENSION: Record<TipoArchivo, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}

export interface ArchivoSorteo {
    id: number
    sorteo_id: number
    empresa_id: number
    uso: UsoArchivoSorteo
    nombre: string
    tipo: TipoArchivo
    tamano: number
    sha256: string
    ancho: number | null
    alto: number | null
    created_at: Date
}

function invalido(campo: string, message: string, rule: string): ValidacionFallida {
    return new ValidacionFallida([{ field: campo, message, rule }])
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
    if (trozo === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    if (trozo === 'VP8L') {
        const bits = b.readUInt32LE(21)
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
    }
    if (trozo === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1]
    return null
}

export interface ArchivoPreparado {
    contenido: Buffer
    tipo: TipoArchivo
    sha256: string
    ancho: number | null
    alto: number | null
}

/** Valida el contenido según su uso; 422 en `campo` si no cumple. */
export function prepararArchivo(
    contenido: Uint8Array,
    uso: UsoArchivoSorteo,
    campo = 'archivo',
): ArchivoPreparado {
    const b = Buffer.from(contenido)
    if (b.length === 0) throw invalido(campo, 'Falta el archivo', 'required')
    const sha256 = createHash('sha256').update(b).digest('hex')
    if (uso === 'imagen_premio') {
        if (b.length > TAMANO_MAXIMO_IMAGEN) {
            throw invalido(
                campo,
                `La imagen pesa ${Math.ceil(b.length / 1024)} KB; el máximo es 1024 KB`,
                'tamano',
            )
        }
        const candidatos: Array<[TipoArchivo, [number, number] | null]> = [
            ['image/png', dimensionesPng(b)],
            ['image/jpeg', dimensionesJpeg(b)],
            ['image/webp', dimensionesWebp(b)],
        ]
        const hallado = candidatos.find(([, d]) => d !== null)
        if (!hallado) throw invalido(campo, 'La imagen debe ser PNG, JPEG o WebP', 'tipo')
        const [tipo, [ancho, alto]] = hallado as [TipoArchivo, [number, number]]
        if (ancho < LADO_MINIMO || alto < LADO_MINIMO || ancho > LADO_MAXIMO || alto > LADO_MAXIMO) {
            throw invalido(
                campo,
                `La imagen mide ${ancho}×${alto} px; cada lado debe medir entre ${LADO_MINIMO} y ${LADO_MAXIMO} px`,
                'dimensiones',
            )
        }
        return { contenido: b, tipo, sha256, ancho, alto }
    }
    if (b.length > TAMANO_MAXIMO_EVIDENCIA) {
        throw invalido(
            campo,
            `El archivo pesa ${Math.ceil(b.length / 1024)} KB; el máximo es 5120 KB`,
            'tamano',
        )
    }
    const tipo = detectarTipoComprobante(b)
    if (!tipo || (uso === 'acta' && tipo !== 'application/pdf')) {
        throw invalido(campo, 'El archivo debe ser PDF, JPEG, PNG o WebP', 'tipo')
    }
    return { contenido: b, tipo, sha256, ancho: null, alto: null }
}

export function directorioSorteos(): string {
    return join(directorioComprobantes(), 'sorteos')
}

function absoluta(ruta: string): string {
    const raiz = resolve(directorioSorteos())
    const destino = resolve(raiz, ruta)
    const rel = relative(raiz, destino)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new NoEncontrado('El archivo no existe')
    }
    return destino
}

async function leerContenido(ruta: string): Promise<Buffer> {
    try {
        return await readFile(absoluta(ruta))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NoEncontrado('El archivo no está en el almacenamiento')
        }
        throw error
    }
}

const COLUMNAS = [
    'id',
    'sorteo_id',
    'empresa_id',
    'uso',
    'nombre',
    'tipo',
    'tamano',
    'sha256',
    'ancho',
    'alto',
    'created_at',
] as const

function aVista(f: Record<string, unknown>): ArchivoSorteo {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        ...(f as unknown as ArchivoSorteo),
        id: Number(f.id),
        sorteo_id: Number(f.sorteo_id),
        empresa_id: Number(f.empresa_id),
        tamano: Number(f.tamano),
        ancho: n(f.ancho),
        alto: n(f.alto),
    }
}

/**
 * Guarda el archivo en disco (ruta nueva, `wx`) y su fila. Si la fila falla, borra el archivo. La
 * fila es de solo inserción: el archivo nunca se reemplaza; uno nuevo es otra fila.
 */
export async function registrarArchivo(
    t: Transaccion,
    sorteo: { id: number; empresa_id: number },
    uso: UsoArchivoSorteo,
    nombre: string,
    archivo: ArchivoPreparado,
): Promise<ArchivoSorteo> {
    const ruta = `${sorteo.empresa_id}/${sorteo.id}/${randomUUID()}.${EXTENSION[archivo.tipo]}`
    const destino = absoluta(ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, archivo.contenido, { flag: 'wx' })
    try {
        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.sorteos_archivos')
            .insert({
                sorteo_id: sorteo.id,
                empresa_id: sorteo.empresa_id,
                uso,
                nombre: nombre.trim().slice(0, 200) || `${uso}.${EXTENSION[archivo.tipo]}`,
                tipo: archivo.tipo,
                tamano: archivo.contenido.length,
                sha256: archivo.sha256,
                ruta,
                ancho: archivo.ancho,
                alto: archivo.alto,
                subido_por: usuarioDelActor(t.ctx.actor),
            })
            .returning([...COLUMNAS])) as Array<Record<string, unknown>>
        return aVista(fila!)
    } catch (error) {
        await rm(destino, { force: true })
        throw error
    }
}

export async function verArchivo(
    sorteoId: number,
    archivoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ArchivoSorteo> {
    const fila = (await cliente
        .from('lealtad.sorteos_archivos')
        .where({ id: archivoId, sorteo_id: sorteoId })
        .select(...COLUMNAS)
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El archivo ${archivoId} no es del sorteo ${sorteoId}`)
    return aVista(fila)
}

/** Contenido del archivo; 409 si su huella ya no coincide con la registrada (alterado en disco). */
export async function contenidoArchivo(sorteoId: number, archivoId: number) {
    const fila = (await db
        .from('lealtad.sorteos_archivos')
        .where({ id: archivoId, sorteo_id: sorteoId })
        .select('ruta', 'sha256', 'tipo', 'nombre')
        .first()) as { ruta: string; sha256: string; tipo: string; nombre: string } | null
    if (!fila) throw new NoEncontrado(`El archivo ${archivoId} no es del sorteo ${sorteoId}`)
    const contenido = await leerContenido(fila.ruta)
    const huella = createHash('sha256').update(contenido).digest('hex')
    if (huella !== fila.sha256) {
        throw new NoEncontrado(`El archivo ${archivoId} no coincide con su huella registrada`)
    }
    return { contenido, tipo: fila.tipo, nombre: fila.nombre, sha256: fila.sha256 }
}

export async function archivosDeSorteo(sorteoId: number, cliente: QueryClientContract = db.connection()) {
    const filas = (await cliente
        .from('lealtad.sorteos_archivos')
        .where('sorteo_id', sorteoId)
        .orderBy('id', 'asc')
        .select(...COLUMNAS)) as Array<Record<string, unknown>>
    return filas.map(aVista)
}
