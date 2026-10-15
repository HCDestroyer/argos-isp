import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import env from '#start/env'

/**
 * Cifrado `v1` de secretos de red que `aaa` y `coa` necesitan en claro: `core.servicios.pass_ppp`,
 * `network.routers.radius_secret` y `network.routers.api_password`.
 *
 * Formato `v1.<iv>.<tag>.<datos>`: AES-256-GCM, IV de 12 bytes, tag de 16, las tres partes en
 * base64url sin relleno. Clave: `AAA_PPP_KEY` (32 bytes en base64), la misma en `apps/api` (cifra)
 * y en `services/aaa` y `services/coa` (descifran). Es el contrato de `services/aaa/src/cifrado.ts`
 * (A2); no se usa `encryption` de AdonisJS porque esos servicios no tienen `APP_KEY`.
 */

const VERSION = 'v1'
const ALGORITMO = 'aes-256-gcm'

export class ErrorCifrado extends Error {}

/** Decodifica la clave (base64 o base64url, 32 bytes). */
export function claveDesdeTexto(valor: string | undefined): Buffer {
    if (!valor) throw new ErrorCifrado('AAA_PPP_KEY no está definida')
    const clave = Buffer.from(valor, 'base64')
    if (clave.length !== 32) throw new ErrorCifrado('AAA_PPP_KEY debe tener 32 bytes en base64')
    return clave
}

function claveDelEntorno(): Buffer {
    return claveDesdeTexto(env.get('AAA_PPP_KEY'))
}

export function cifrar(texto: string, clave: Buffer = claveDelEntorno()): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITMO, clave, iv)
    const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), datos.toString('base64url')].join(
        '.',
    )
}

export function descifrar(valor: string, clave: Buffer = claveDelEntorno()): string {
    const partes = valor.split('.')
    if (partes.length !== 4 || partes[0] !== VERSION) {
        throw new ErrorCifrado('formato de secreto cifrado desconocido (se espera v1.<iv>.<tag>.<datos>)')
    }
    const [, ivB64, tagB64, datosB64] = partes as [string, string, string, string]
    const iv = Buffer.from(ivB64, 'base64url')
    const tag = Buffer.from(tagB64, 'base64url')
    if (iv.length !== 12 || tag.length !== 16) throw new ErrorCifrado('IV o tag con longitud inválida')
    try {
        const decipher = createDecipheriv(ALGORITMO, clave, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([
            decipher.update(Buffer.from(datosB64, 'base64url')),
            decipher.final(),
        ]).toString('utf8')
    } catch {
        // Sin el valor ni la causa: podría filtrar material del secreto en logs.
        throw new ErrorCifrado('no se pudo descifrar el secreto (clave distinta o dato alterado)')
    }
}

/** null/undefined pasan tal cual (columnas opcionales). */
export function cifrarOpcional(texto: string | null | undefined): string | null | undefined {
    return texto === null || texto === undefined ? texto : cifrar(texto)
}
