import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Firma de CoA-Request / Disconnect-Request y verificación de sus respuestas (RFC 5176 §2.3 y §3.5,
 * igual que `rad_sign` / `rad_verify` de FreeRADIUS, que es lo que RouterOS acepta).
 *
 * El paquete `radius` 1.1.4 calcula mal estas dos firmas cuando la petición lleva
 * Message-Authenticator (firma el Request Authenticator con el MA en ceros y luego el MA con el
 * autenticador ya puesto), así que `coa` codifica los atributos con `radius` y firma aquí:
 *
 *   1. Request Authenticator = 16 ceros; MA = 16 ceros.
 *   2. MA = HMAC-MD5(paquete, secret).
 *   3. Request Authenticator = MD5(paquete con el MA ya escrito y el autenticador en ceros + secret).
 *
 * Respuesta (ACK/NAK): Response Authenticator = MD5(código, id, largo, Request Authenticator,
 * atributos, secret); si trae MA, HMAC-MD5 del paquete con el Request Authenticator y el MA en ceros.
 */

const AUTH_INICIO = 4
const AUTH_FIN = 20
const TIPO_MA = 80

/** Posición del valor del Message-Authenticator (o -1 si no está). */
export function posicionMa(paquete: Buffer): number {
    const largo = paquete.readUInt16BE(2)
    let i = AUTH_FIN
    while (i + 2 <= largo) {
        const tipo = paquete.readUInt8(i)
        const l = paquete.readUInt8(i + 1)
        if (l < 2) return -1
        if (tipo === TIPO_MA && l === 18) return i + 2
        i += l
    }
    return -1
}

function iguales(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b)
}

/** Firma en sitio una petición ya codificada (con un Message-Authenticator de 16 ceros). */
export function firmarPeticion(paquete: Buffer, secret: string): Buffer {
    paquete.fill(0, AUTH_INICIO, AUTH_FIN)
    const ma = posicionMa(paquete)
    if (ma >= 0) {
        paquete.fill(0, ma, ma + 16)
        createHmac('md5', secret).update(paquete).digest().copy(paquete, ma)
    }
    createHash('md5').update(paquete).update(secret).digest().copy(paquete, AUTH_INICIO)
    return paquete
}

/** Verifica una petición CoA/Disconnect como lo haría el NAS (lo usa el NAS simulado de las pruebas). */
export function verificarPeticion(paquete: Buffer, secret: string): boolean {
    const copia = Buffer.from(paquete.subarray(0, paquete.readUInt16BE(2)))
    const autenticador = Buffer.from(copia.subarray(AUTH_INICIO, AUTH_FIN))
    copia.fill(0, AUTH_INICIO, AUTH_FIN)
    if (!iguales(createHash('md5').update(copia).update(secret).digest(), autenticador)) return false
    const ma = posicionMa(copia)
    if (ma < 0) return true
    const recibido = Buffer.from(copia.subarray(ma, ma + 16))
    copia.fill(0, ma, ma + 16)
    return iguales(createHmac('md5', secret).update(copia).digest(), recibido)
}

/** Verifica que `respuesta` responde a `peticion` y viene firmada con `secret`. */
export function verificarRespuesta(peticion: Buffer, respuesta: Buffer, secret: string): boolean {
    if (respuesta.length < AUTH_FIN || respuesta.readUInt8(1) !== peticion.readUInt8(1)) return false
    const largo = respuesta.readUInt16BE(2)
    if (largo < AUTH_FIN || largo > respuesta.length) return false
    const copia = Buffer.from(respuesta.subarray(0, largo))
    const recibido = Buffer.from(copia.subarray(AUTH_INICIO, AUTH_FIN))
    peticion.copy(copia, AUTH_INICIO, AUTH_INICIO, AUTH_FIN)
    if (!iguales(createHash('md5').update(copia).update(secret).digest(), recibido)) return false
    const ma = posicionMa(copia)
    if (ma < 0) return true
    const maRecibido = Buffer.from(copia.subarray(ma, ma + 16))
    copia.fill(0, ma, ma + 16)
    return iguales(createHmac('md5', secret).update(copia).digest(), maRecibido)
}
