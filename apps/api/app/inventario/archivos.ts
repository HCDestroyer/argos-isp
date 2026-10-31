import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { detectarTipoComprobante, directorioComprobantes } from '#billing/comprobantes_archivos'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'

/**
 * Archivos del inventario (fase D, `contratos/inventario.md` D.1 y D.5): la firma del técnico al
 * recibir una orden de traslado, el papel firmado escaneado y la factura de compra que arma un
 * borrador. Mismo almacenamiento que los comprobantes, los logos y los sorteos (disco en
 * `COMPROBANTES_DIR`, subcarpeta `inventario/`), nunca en la base: la fila guarda la ruta relativa,
 * el SHA-256, el tipo y el tamaño. El tipo se decide por el contenido, no por el nombre.
 *
 * En la auditoría un archivo va como `{ bytes, sha256 }` (`ArchivoAdjunto.toJSON`), nunca el binario.
 */

export const TAMANO_MAXIMO_FIRMA = 256 * 1024
export const TAMANO_MAXIMO_DOCUMENTO = 5 * 1024 * 1024
export const TAMANO_MAXIMO_FACTURA = 10 * 1024 * 1024
export const LADO_MINIMO_FIRMA = 50
export const LADO_MAXIMO_FIRMA = 4000

export type TipoArchivoInventario =
    'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | 'application/xml'

const EXTENSION: Record<TipoArchivoInventario, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/xml': 'xml',
}

export function sha256(contenido: Uint8Array): string {
    return createHash('sha256').update(contenido).digest('hex')
}

/** Un archivo que llega a una acción: en la auditoría solo su tamaño y su huella. */
export class ArchivoAdjunto {
    readonly sha256: string

    constructor(
        readonly contenido: Buffer,
        readonly nombre: string | null = null,
    ) {
        this.sha256 = sha256(contenido)
    }

    toJSON() {
        return { bytes: this.contenido.length, sha256: this.sha256, nombre: this.nombre }
    }
}

function invalido(campo: string, message: string, rule: string): ValidacionFallida {
    return new ValidacionFallida([{ field: campo, message, rule }])
}

/** Ancho y alto de un PNG (su IHDR); null si no es un PNG. */
export function dimensionesPng(b: Buffer): [number, number] | null {
    const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (b.length < 24 || !firma.every((byte, i) => b[i] === byte)) return null
    if (b.toString('latin1', 12, 16) !== 'IHDR') return null
    return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

/**
 * Firma del trazo en base64 (con o sin `data:image/png;base64,`). 422 en `campo` si no es base64.
 */
export function firmaDesdeBase64(valor: string, campo = 'firma'): ArchivoAdjunto {
    const limpio = valor
        .trim()
        .replace(/^data:image\/png;base64,/i, '')
        .replace(/\s+/g, '')
    if (limpio === '' || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(limpio)) {
        throw invalido(campo, 'La firma va como PNG en base64', 'formato')
    }
    return new ArchivoAdjunto(Buffer.from(limpio, 'base64'), 'firma.png')
}

/** Firma del técnico: PNG por su contenido, hasta 256 KB y de 50 a 4000 px por lado. */
export function validarFirma(archivo: ArchivoAdjunto, campo = 'firma'): void {
    const b = archivo.contenido
    if (b.length === 0) throw invalido(campo, 'Falta la firma', 'required')
    if (b.length > TAMANO_MAXIMO_FIRMA) {
        throw invalido(
            campo,
            `La firma pesa ${Math.ceil(b.length / 1024)} KB; el máximo es ${TAMANO_MAXIMO_FIRMA / 1024} KB`,
            'tamano',
        )
    }
    const dimensiones = dimensionesPng(b)
    if (!dimensiones) throw invalido(campo, 'La firma debe ser una imagen PNG', 'tipo')
    const [ancho, alto] = dimensiones
    if (
        ancho < LADO_MINIMO_FIRMA ||
        alto < LADO_MINIMO_FIRMA ||
        ancho > LADO_MAXIMO_FIRMA ||
        alto > LADO_MAXIMO_FIRMA
    ) {
        throw invalido(
            campo,
            `La firma mide ${ancho}×${alto} px; cada lado debe medir entre ${LADO_MINIMO_FIRMA} y ${LADO_MAXIMO_FIRMA} px`,
            'dimensiones',
        )
    }
}

/** Foto o escaneo del papel firmado: JPG, PNG, WebP o PDF por su contenido, hasta 5 MB. */
export function tipoDocumentoFirmado(archivo: ArchivoAdjunto, campo = 'archivo'): TipoArchivoInventario {
    const b = archivo.contenido
    if (b.length === 0) throw invalido(campo, 'Falta el archivo', 'required')
    if (b.length > TAMANO_MAXIMO_DOCUMENTO) {
        throw invalido(
            campo,
            `El archivo pesa ${Math.ceil(b.length / 1024)} KB; el máximo es ${TAMANO_MAXIMO_DOCUMENTO / 1024} KB`,
            'tamano',
        )
    }
    const tipo = detectarTipoComprobante(b)
    if (!tipo) throw invalido(campo, 'El archivo debe ser JPG, PNG, WebP o PDF', 'tipo')
    return tipo
}

/** ¿Parece XML? (BOM y espacios permitidos antes de `<`). */
export function esXml(b: Buffer): boolean {
    const inicio = b
        .subarray(0, 512)
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .trimStart()
    return inicio.startsWith('<?xml') || inicio.startsWith('<')
}

/** Factura de compra: XML, PDF, JPG, PNG o WebP por su contenido, hasta 10 MB. */
export function tipoFacturaCompra(archivo: ArchivoAdjunto, campo = 'archivo'): TipoArchivoInventario {
    const b = archivo.contenido
    if (b.length === 0) throw invalido(campo, 'Falta el archivo', 'required')
    if (b.length > TAMANO_MAXIMO_FACTURA) {
        throw invalido(
            campo,
            `El archivo pesa ${Math.ceil(b.length / 1024)} KB; el máximo es ${TAMANO_MAXIMO_FACTURA / 1024} KB`,
            'tamano',
        )
    }
    const tipo = detectarTipoComprobante(b)
    if (tipo) return tipo
    if (esXml(b)) return 'application/xml'
    throw invalido(campo, 'La factura debe ser XML (FEL), PDF o una imagen JPG, PNG o WebP', 'tipo')
}

export function directorioInventario(): string {
    return join(directorioComprobantes(), 'inventario')
}

function absoluta(ruta: string): string {
    const raiz = resolve(directorioInventario())
    const destino = resolve(raiz, ruta)
    const rel = relative(raiz, destino)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new NoEncontrado('El archivo no existe')
    }
    return destino
}

/** Guarda el archivo en `<carpeta>/AAAA/MM/<uuid>.<ext>` y devuelve la ruta relativa. */
export async function guardarArchivoInventario(
    carpeta: 'firmas' | 'documentos' | 'compras',
    tipo: TipoArchivoInventario,
    contenido: Buffer,
    ahora = new Date(),
): Promise<string> {
    const anio = String(ahora.getUTCFullYear())
    const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0')
    const ruta = `${carpeta}/${anio}/${mes}/${randomUUID()}.${EXTENSION[tipo]}`
    const destino = absoluta(ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, { flag: 'wx' })
    return ruta
}

/** Lee un archivo y verifica su huella (404 si falta o si cambió en el disco). */
export async function leerArchivoInventario(ruta: string, huella: string): Promise<Buffer> {
    let contenido: Buffer
    try {
        contenido = await readFile(absoluta(ruta))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NoEncontrado('El archivo no está en el almacenamiento')
        }
        throw error
    }
    if (sha256(contenido) !== huella) {
        throw new NoEncontrado('El archivo en el almacenamiento no coincide con su huella')
    }
    return contenido
}

/** Borra un archivo que quedó huérfano (la transacción que lo registraba falló). */
export async function borrarArchivoInventario(ruta: string): Promise<void> {
    await rm(absoluta(ruta), { force: true })
}
