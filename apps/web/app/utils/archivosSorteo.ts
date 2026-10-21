import type { Schema } from '@argosisp/contracts'

/**
 * Archivos de un sorteo (A3, `a3/sorteos-2`, `sorteos_archivos.ts`): evidencias del checklist y
 * constancias firmadas de una entrega. PDF, JPEG, PNG o WebP según su **contenido**, hasta 5 MB; solo
 * inserción, con su SHA-256. El panel los revisa antes de subirlos con las mismas reglas y mensajes.
 */

export type ArchivoSorteo = Schema<'ArchivoSorteo'>
export type UsoArchivoSorteo = 'evidencia' | 'constancia'

export const TAMANO_MAXIMO_EVIDENCIA = 5 * 1024 * 1024
export const TIPOS_ARCHIVO_SORTEO = 'application/pdf,image/jpeg,image/png,image/webp'

export const USOS_ARCHIVO_SORTEO: Record<ArchivoSorteo['uso'], string> = {
    evidencia: 'Evidencia',
    constancia: 'Constancia de entrega',
    imagen_premio: 'Imagen de premio',
    acta: 'Acta',
}

/** Tipo por la firma del contenido (como `detectarTipoComprobante` de la API), o `null`. */
export function tipoArchivoSorteo(b: Uint8Array): ArchivoSorteo['tipo'] | null {
    const empieza = (firma: number[], desde = 0) => firma.every((byte, i) => b[desde + i] === byte)
    if (empieza([0x25, 0x50, 0x44, 0x46, 0x2D])) {
        return 'application/pdf'
    }
    if (empieza([0xFF, 0xD8, 0xFF])) {
        return 'image/jpeg'
    }
    if (empieza([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
        return 'image/png'
    }
    if (empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8)) {
        return 'image/webp'
    }
    return null
}

/** El error que daría la API (mismo texto), o `null` si el archivo sirve. */
export function errorArchivoSorteo(b: Uint8Array): string | null {
    if (b.length === 0) {
        return 'Falta el archivo'
    }
    if (b.length > TAMANO_MAXIMO_EVIDENCIA) {
        return `El archivo pesa ${Math.ceil(b.length / 1024)} KB; el máximo es 5120 KB`
    }
    return tipoArchivoSorteo(b) ? null : 'El archivo debe ser PDF, JPEG, PNG o WebP'
}

/** Tamaño legible de un archivo. */
export function tamanoArchivo(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Un `Blob` (también el de otra implementación, como el de happy-dom en las pruebas). */
export function esBlob(valor: unknown): valor is Blob {
    return valor instanceof Blob || (typeof valor === 'object' && valor !== null && typeof Reflect.get(valor, 'arrayBuffer') === 'function' && typeof Reflect.get(valor, 'type') === 'string')
}

/** Guarda un archivo descargado con su nombre (la URL de objeto se libera después). */
export function guardarBlob(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob)
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombre
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
