/**
 * Firma digital en pantalla para recibir una orden de traslado (`contratos/inventario.md` D.1): un
 * PNG de hasta 200 KB (decodificado) y de 50×20 a 1000×400 px, con su SHA-256 calculado en el
 * navegador. La API rechaza lo demás con 422 `firma_invalida`; aquí se revisa antes de enviar.
 */

export const FIRMA_BYTES_MAXIMO = 200 * 1024
export const FIRMA_ANCHO = { minimo: 50, maximo: 1000 }
export const FIRMA_ALTO = { minimo: 20, maximo: 400 }

export type FirmaCapturada = {
    /** PNG en base64, sin el prefijo `data:`. */
    png_base64: string
    /** SHA-256 en hexadecimal del PNG decodificado. */
    sha256: string
    bytes: number
    ancho: number
    alto: number
}

const FIRMA_PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

/** Ancho y alto de un PNG (cabecera IHDR), o `null` si no es un PNG. */
export function medidasPng(bytes: Uint8Array): { ancho: number, alto: number } | null {
    if (bytes.length < 24 || FIRMA_PNG.some((b, i) => bytes[i] !== b)) {
        return null
    }
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { ancho: vista.getUint32(16), alto: vista.getUint32(20) }
}

/** El error que daría la API para esta firma (mismo criterio), o `null` si sirve. */
export function errorFirma(bytes: Uint8Array): string | null {
    const medidas = medidasPng(bytes)
    if (!medidas) {
        return 'La firma debe ser una imagen PNG'
    }
    if (bytes.length > FIRMA_BYTES_MAXIMO) {
        return `La firma pesa ${Math.ceil(bytes.length / 1024)} KB; el máximo es 200 KB`
    }
    if (medidas.ancho < FIRMA_ANCHO.minimo || medidas.ancho > FIRMA_ANCHO.maximo || medidas.alto < FIRMA_ALTO.minimo || medidas.alto > FIRMA_ALTO.maximo) {
        return `La firma mide ${medidas.ancho}×${medidas.alto} px; debe medir de 50×20 a 1000×400 px`
    }
    return null
}

/** SHA-256 en hexadecimal (Web Crypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const copia = new Uint8Array(bytes.byteLength)
    copia.set(bytes)
    const huella = await crypto.subtle.digest('SHA-256', copia.buffer)
    return [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function base64DeBytes(bytes: Uint8Array): string {
    let binario = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binario)
}

/** Arma la firma que viaja a la API desde los bytes del PNG; `error` si no cumple el contrato. */
export async function firmaDesdePng(bytes: Uint8Array): Promise<{ ok: true, firma: FirmaCapturada } | { ok: false, error: string }> {
    const error = errorFirma(bytes)
    const medidas = medidasPng(bytes)
    if (error || !medidas) {
        return { ok: false, error: error ?? 'La firma debe ser una imagen PNG' }
    }
    return { ok: true, firma: { png_base64: base64DeBytes(bytes), sha256: await sha256Hex(bytes), bytes: bytes.length, ancho: medidas.ancho, alto: medidas.alto } }
}

/** Medidas del lienzo de la firma dentro de los límites, a partir del tamaño en pantalla. */
export function medidasLienzo(anchoCss: number, altoCss: number): { ancho: number, alto: number } {
    const limitar = (valor: number, { minimo, maximo }: { minimo: number, maximo: number }) => Math.min(maximo, Math.max(minimo, Math.round(valor)))
    return { ancho: limitar(anchoCss, FIRMA_ANCHO), alto: limitar(altoCss, FIRMA_ALTO) }
}

/** Los primeros 12 caracteres del SHA-256 (los que imprime el PDF de la orden). */
export function huellaCorta(sha256: string | null | undefined): string {
    return sha256 ? sha256.slice(0, 12) : '—'
}
