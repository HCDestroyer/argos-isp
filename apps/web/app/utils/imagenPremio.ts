/**
 * Imagen de un premio de sorteo (A3, `a3/sorteos-2`, `sorteos_archivos.ts`): PNG, JPEG o WebP según su
 * **contenido** (no la extensión ni el `type` del navegador), hasta 1 MB y de 64 a 4096 px por lado. El
 * panel la revisa antes de subirla con las mismas reglas y mensajes que la API (que vuelve a revisarla).
 */

export const TAMANO_MAXIMO_IMAGEN_PREMIO = 1024 * 1024
export const LADO_MINIMO_IMAGEN_PREMIO = 64
export const LADO_MAXIMO_IMAGEN_PREMIO = 4096
export const TIPOS_IMAGEN_PREMIO = 'image/png,image/jpeg,image/webp'

export type TipoImagenPremio = 'image/png' | 'image/jpeg' | 'image/webp'

function texto(b: Uint8Array, desde: number, hasta: number): string {
    return String.fromCharCode(...b.subarray(desde, hasta))
}

function dimensionesPng(b: Uint8Array, v: DataView): [number, number] | null {
    const firma = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    if (b.length < 24 || !firma.every((byte, i) => b[i] === byte) || texto(b, 12, 16) !== 'IHDR') {
        return null
    }
    return [v.getUint32(16), v.getUint32(20)]
}

function dimensionesJpeg(b: Uint8Array, v: DataView): [number, number] | null {
    if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) {
        return null
    }
    let i = 2
    while (i + 9 < b.length) {
        if (b[i] !== 0xFF) {
            return null
        }
        const marca = b[i + 1] ?? 0
        if (marca === 0xFF) {
            i += 1
            continue
        }
        const largo = v.getUint16(i + 2)
        // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC)
        if (marca >= 0xC0 && marca <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marca)) {
            return [v.getUint16(i + 7), v.getUint16(i + 5)]
        }
        if (largo < 2) {
            return null
        }
        i += 2 + largo
    }
    return null
}

function dimensionesWebp(b: Uint8Array, v: DataView): [number, number] | null {
    if (b.length < 30 || texto(b, 0, 4) !== 'RIFF' || texto(b, 8, 12) !== 'WEBP') {
        return null
    }
    const trozo = texto(b, 12, 16)
    if (trozo === 'VP8 ') {
        return [v.getUint16(26, true) & 0x3FFF, v.getUint16(28, true) & 0x3FFF]
    }
    if (trozo === 'VP8L') {
        const bits = v.getUint32(21, true)
        return [(bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1]
    }
    if (trozo === 'VP8X') {
        const lado = (o: number) => ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)) + 1
        return [lado(24), lado(27)]
    }
    return null
}

/** Tipo y tamaño en px leídos de la cabecera, o `null` si no es PNG, JPEG ni WebP. */
export function leerImagenPremio(bytes: Uint8Array): { tipo: TipoImagenPremio, ancho: number, alto: number } | null {
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const candidatos: [TipoImagenPremio, [number, number] | null][] = [
        ['image/png', dimensionesPng(bytes, vista)],
        ['image/jpeg', dimensionesJpeg(bytes, vista)],
        ['image/webp', dimensionesWebp(bytes, vista)],
    ]
    for (const [tipo, d] of candidatos) {
        if (d) {
            return { tipo, ancho: d[0], alto: d[1] }
        }
    }
    return null
}

/** El error que daría la API (mismo texto), o `null` si la imagen sirve. */
export function errorImagenPremio(bytes: Uint8Array): string | null {
    if (bytes.length === 0) {
        return 'Falta el archivo'
    }
    if (bytes.length > TAMANO_MAXIMO_IMAGEN_PREMIO) {
        return `La imagen pesa ${Math.ceil(bytes.length / 1024)} KB; el máximo es 1024 KB`
    }
    const leida = leerImagenPremio(bytes)
    if (!leida) {
        return 'La imagen debe ser PNG, JPEG o WebP'
    }
    const { ancho, alto } = leida
    if ([ancho, alto].some(l => l < LADO_MINIMO_IMAGEN_PREMIO || l > LADO_MAXIMO_IMAGEN_PREMIO)) {
        return `La imagen mide ${ancho}×${alto} px; cada lado debe medir entre ${LADO_MINIMO_IMAGEN_PREMIO} y ${LADO_MAXIMO_IMAGEN_PREMIO} px`
    }
    return null
}
