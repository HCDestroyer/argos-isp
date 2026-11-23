import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { Problema } from '#shared/errores'
import type { ArchivoIris } from '#portal/soporte/iris_portal'

/**
 * Adjuntos de un ticket desde el portal (contrato Iris 0.9.0 §11.6): hasta 3 por mensaje, 10 MB
 * cada uno, solo JPEG, PNG y PDF **por el contenido** (nunca por el nombre ni por el `Content-Type`
 * del navegador). Desde 0.14.2 (§11.6) Iris no acepta HEIC ni WebP: el portal los convierte a JPEG en
 * el navegador (`apps/portal/app/utils/fotos.ts`) y aquí un HEIC o WebP que llegue igual responde
 * 422 `mime_no_permitido` sin llamar a Iris. Argos los revisa antes de mandarlos para no gastar el
 * envío, e Iris los vuelve a revisar, recodifica y les quita los metadatos. El total por petición lo
 * acota además el bodyparser (20 MB: `config/bodyparser.ts`).
 */

export const MAXIMO_ADJUNTOS = 3
export const TAMANO_MAXIMO_ADJUNTO = 10 * 1024 * 1024

export type MimeAdjunto = 'image/jpeg' | 'image/png' | 'application/pdf'

function empiezaCon(bytes: Uint8Array, firma: number[], desde = 0): boolean {
    return firma.every((b, i) => bytes[desde + i] === b)
}

/** Tipo real por los primeros bytes, o null si no es uno de los permitidos (WebP y HEIC no lo son). */
export function detectarMimeAdjunto(bytes: Uint8Array): MimeAdjunto | null {
    if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
    if (empiezaCon(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
    return null
}

/** Nombre sin rutas ni caracteres de control, hasta 120 caracteres (como lo guarda Iris). */
export function nombreSaneado(nombre: string | null | undefined, mime: MimeAdjunto): string {
    const base = (nombre ?? '')
        .split(/[\\/]/)
        .pop()!
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f"]/g, '')
        .trim()
        .slice(0, 120)
    if (base) return base
    const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'application/pdf': 'pdf',
    }[mime]
    return `adjunto.${extension}`
}

/** 413 `tamano_excedido` (§11.6). */
export class TamanoExcedido extends Problema {
    constructor() {
        super(413, 'tamano_excedido', 'Archivo muy grande', 'Cada archivo puede pesar hasta 10 MB.')
    }
}

/**
 * Archivos del campo `archivos` del multipart, ya revisados. `permitidos = false` (sesión `ip`):
 * con cualquier archivo responde 422 `adjuntos_no_permitidos`, como Iris.
 */
export async function adjuntosDeLaPeticion(ctx: HttpContext, permitidos: boolean): Promise<ArchivoIris[]> {
    const archivos = ctx.request.files('archivos').filter((a) => a.tmpPath)
    if (archivos.length === 0) return []
    if (!permitidos) {
        throw new Problema(
            422,
            'adjuntos_no_permitidos',
            'Sin adjuntos',
            'Para adjuntar fotos o PDF entra con tu código o tu contraseña.',
        )
    }
    if (archivos.length > MAXIMO_ADJUNTOS) {
        throw new Problema(
            422,
            'demasiados_adjuntos',
            'Demasiados archivos',
            'Puedes adjuntar hasta 3 archivos.',
        )
    }
    const salida: ArchivoIris[] = []
    for (const [i, archivo] of archivos.entries()) {
        if (archivo.size > TAMANO_MAXIMO_ADJUNTO) throw new TamanoExcedido()
        const contenido = new Uint8Array(await readFile(archivo.tmpPath!))
        const mime = detectarMimeAdjunto(contenido)
        if (!mime) {
            throw new Problema(
                422,
                'mime_no_permitido',
                'Tipo de archivo no permitido',
                'Solo fotos JPG o PNG y PDF.',
                [
                    {
                        field: `archivos.${i}`,
                        rule: 'mime',
                        message: 'Solo fotos JPG o PNG y PDF',
                    },
                ],
            )
        }
        salida.push({ nombre: nombreSaneado(archivo.clientName, mime), mime, contenido })
    }
    return salida
}

/** Lo que se audita de los adjuntos: nombre, tipo y tamaño, nunca el contenido. */
export function adjuntosParaAuditoria(archivos: ArchivoIris[]) {
    return archivos.map((a) => ({ nombre: a.nombre, mime: a.mime, tamano: a.contenido.byteLength }))
}
