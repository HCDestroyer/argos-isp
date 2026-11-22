/**
 * Fotos y PDF que el cliente sube desde el portal: adjuntos de tickets (van a Iris, contrato 0.14.2
 * §11.6) y comprobantes de pago (van a Argos). Iris solo acepta JPEG, PNG y PDF; el portal convierte
 * en el navegador cualquier otra foto (HEIC del iPhone, WebP, AVIF…) a JPEG antes de subirla.
 *
 * - JPEG, PNG y PDF pasan sin tocar. Un JPEG o PNG que supera el tope del endpoint se reescala a JPEG.
 * - Otra imagen se dibuja en un canvas y sale en JPEG (calidad 0,85, lado mayor ≤ 2560 px). El canvas
 *   no copia el EXIF: la foto sale sin GPS ni datos de la cámara (la orientación ya viene aplicada
 *   al decodificar).
 * - Si el navegador no puede leer la imagen (HEIC en Chrome o Android), no se sube nada y se pide
 *   otra foto con `ERROR_FOTO_ILEGIBLE`.
 */

/** Tipos que Iris y Argos aceptan tal cual. */
export const TIPOS_SUBIBLES = ['image/jpeg', 'image/png', 'application/pdf'] as const

/**
 * `accept` de los selectores. Con tipos concretos (y no `image/*`) Safari en iOS convierte la foto
 * HEIC de la galería a JPEG al entregarla; la cámara del teléfono sigue disponible.
 */
export const ACEPTA_FOTOS = 'image/jpeg,image/png,application/pdf'

export const CALIDAD_JPEG = 0.85
export const LADO_MAXIMO_FOTO = 2560

export const ERROR_FOTO_ILEGIBLE = 'No pudimos leer esta foto. Tómala de nuevo o elige otra en JPG o PNG.'

/** Extensiones de imagen que algunos navegadores entregan con `type` vacío (HEIC en Windows o Android). */
const EXTENSIONES_IMAGEN = /\.(heic|heif|webp|avif|gif|bmp|tiff?|jxl)$/i

export type ArchivoPreparado = { ok: true, archivo: File, convertido: boolean } | { ok: false, error: string }

/** ¿Es una imagen (por tipo declarado o, sin tipo, por extensión)? */
export function esArchivoImagen(archivo: File): boolean {
    return archivo.type.startsWith('image/') || (archivo.type === '' && EXTENSIONES_IMAGEN.test(archivo.name))
}

/** ¿Lo acepta Iris tal cual (JPEG, PNG o PDF)? */
export function esTipoSubible(archivo: File): boolean {
    return (TIPOS_SUBIBLES as readonly string[]).includes(archivo.type)
}

/** «boleta.heic» → «boleta.jpg». */
export function nombreJpeg(nombre: string): string {
    const base = nombre.replace(/\.[^.]+$/, '').trim()
    return `${base || 'foto'}.jpg`
}

/** Medidas que caben en `lado` px de lado mayor, sin agrandar. */
export function medidasReducidas(ancho: number, alto: number, lado = LADO_MAXIMO_FOTO): { ancho: number, alto: number } {
    const escala = Math.min(1, lado / Math.max(ancho, alto, 1))
    return {
        ancho: Math.max(1, Math.round(ancho * escala)),
        alto: Math.max(1, Math.round(alto * escala)),
    }
}

interface ImagenDecodificada {
    fuente: CanvasImageSource
    ancho: number
    alto: number
    liberar: () => void
}

/** Decodifica con `createImageBitmap` y, si no existe o falla, con un `<img>`. `null` si no se pudo. */
async function decodificar(archivo: File): Promise<ImagenDecodificada | null> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
            if (bitmap.width > 0 && bitmap.height > 0) {
                return { fuente: bitmap, ancho: bitmap.width, alto: bitmap.height, liberar: () => bitmap.close() }
            }
            bitmap.close()
        }
        catch {
            // se intenta con <img>
        }
    }
    let url: string
    try {
        url = URL.createObjectURL(archivo)
    }
    catch {
        return null
    }
    const imagen = new Image()
    const cargada = await new Promise<boolean>((resolve) => {
        imagen.onload = () => resolve(true)
        imagen.onerror = () => resolve(false)
        imagen.src = url
    })
    if (!cargada || imagen.naturalWidth === 0 || imagen.naturalHeight === 0) {
        URL.revokeObjectURL(url)
        return null
    }
    return { fuente: imagen, ancho: imagen.naturalWidth, alto: imagen.naturalHeight, liberar: () => URL.revokeObjectURL(url) }
}

/** Dibuja la imagen en un canvas de `lado` px de lado mayor y la exporta en JPEG. */
async function aJpeg(imagen: ImagenDecodificada, lado: number): Promise<Blob | null> {
    const { ancho, alto } = medidasReducidas(imagen.ancho, imagen.alto, lado)
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const contexto = lienzo.getContext('2d')
    if (!contexto) {
        return null
    }
    // JPEG no tiene transparencia: fondo blanco (un PNG transparente no sale negro).
    contexto.fillStyle = '#ffffff'
    contexto.fillRect(0, 0, ancho, alto)
    contexto.drawImage(imagen.fuente, 0, 0, ancho, alto)
    return await new Promise<Blob | null>((resolve) => {
        try {
            lienzo.toBlob(resolve, 'image/jpeg', CALIDAD_JPEG)
        }
        catch {
            resolve(null)
        }
    })
}

/**
 * Prepara un archivo elegido por el cliente para subirlo a un endpoint con tope `tamanoMaximo` bytes.
 * Ver el comentario del archivo. Lo que no es imagen (PDF u otro) vuelve igual: el tipo y el tamaño
 * los revisa cada formulario y, al final, la API por el contenido.
 */
export async function prepararArchivo(archivo: File, tamanoMaximo: number): Promise<ArchivoPreparado> {
    if (!esArchivoImagen(archivo)) {
        return { ok: true, archivo, convertido: false }
    }
    const directo = archivo.type === 'image/jpeg' || archivo.type === 'image/png'
    if (directo && archivo.size <= tamanoMaximo) {
        return { ok: true, archivo, convertido: false }
    }

    const imagen = await decodificar(archivo)
    if (!imagen) {
        // Un JPEG o PNG grande que no se pudo reducir va igual: el formulario avisa que pesa demasiado.
        return directo ? { ok: true, archivo, convertido: false } : { ok: false, error: ERROR_FOTO_ILEGIBLE }
    }
    try {
        // Si a 2560 px sigue pasando del tope, se prueba más chica.
        for (const lado of [LADO_MAXIMO_FOTO, 2000, 1600]) {
            const blob = await aJpeg(imagen, lado)
            if (!blob) {
                break
            }
            if (blob.size <= tamanoMaximo) {
                return {
                    ok: true,
                    archivo: new File([blob], nombreJpeg(archivo.name), { type: 'image/jpeg', lastModified: archivo.lastModified }),
                    convertido: true,
                }
            }
        }
        return directo ? { ok: true, archivo, convertido: false } : { ok: false, error: ERROR_FOTO_ILEGIBLE }
    }
    finally {
        imagen.liberar()
    }
}
