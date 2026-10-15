import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Cifrado de secretos de red que `aaa` (y `coa`) necesitan en claro: `core.servicios.pass_ppp` y
 * `network.routers.radius_secret`.
 *
 * Formato `v1.<iv>.<tag>.<texto cifrado>`: AES-256-GCM, IV de 12 bytes, tag de 16 bytes, las tres
 * partes en base64url sin relleno. La clave son 32 bytes en base64 (`AAA_PPP_KEY`), la misma en
 * `apps/api` (que cifra) y en `aaa`/`coa` (que descifran). Contrato completo en `.claude/integration/contratos/aaa.md`.
 */

const VERSION = 'v1'
const ALGORITMO = 'aes-256-gcm'

export class ErrorCifrado extends Error {}

/** Decodifica la clave del entorno (base64 o base64url, 32 bytes). */
export function claveDesdeEntorno(valor: string | undefined): Buffer {
    if (!valor) throw new ErrorCifrado('AAA_PPP_KEY no está definida')
    const clave = Buffer.from(valor, 'base64')
    if (clave.length !== 32) throw new ErrorCifrado('AAA_PPP_KEY debe tener 32 bytes en base64')
    return clave
}

export function cifrar(texto: string, clave: Buffer): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITMO, clave, iv)
    const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), cifrado.toString('base64url')].join(
        '.',
    )
}

export function descifrar(valor: string, clave: Buffer): string {
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
        // No se incluye el valor ni la causa: podría filtrar material del secreto en logs.
        throw new ErrorCifrado('no se pudo descifrar el secreto (clave distinta o dato alterado)')
    }
}
