import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { enteroDeEntorno } from '#portal/redis_portal'

/**
 * Códigos de verificación y tokens de sesión del portal (tarea 7). Funciones puras.
 *
 * - Código: 6 dígitos (`randomInt`), se guarda solo `HMAC-SHA256(APP_KEY, solicitud:código)`.
 *   La `solicitud` (uuid) entra en el HMAC para que dos clientes con el mismo código no tengan
 *   el mismo hash.
 * - Token de sesión: `pcs_` + 32 bytes aleatorios en base64url; se guarda su SHA-256.
 */

export const PREFIJO_TOKEN = 'pcs_'

/** Nombre de la cookie httpOnly de la sesión del portal. */
export const COOKIE_SESION = 'argos_portal'

/** La cookie solo viaja a los endpoints del portal (mismo origen gracias al proxy de Nitro). */
export const RUTA_COOKIE = '/api/v1/portal'

export interface ConfigAcceso {
    /** vigencia del código (`PORTAL_CODIGO_VIGENCIA_S`, 600) */
    codigoVigenciaS: number
    /** intentos de verificación por código (`PORTAL_CODIGO_INTENTOS`, 5) */
    codigoIntentos: number
    /** códigos por cliente por hora (`PORTAL_CODIGO_MAX_HORA`, 5) */
    codigosPorHora: number
    /** inactividad que cierra la sesión (`PORTAL_SESION_INACTIVIDAD_S`, 1800) */
    sesionInactividadS: number
    /** duración máxima de una sesión aunque se use (`PORTAL_SESION_MAX_S`, 14400) */
    sesionMaxS: number
}

export function configAcceso(entorno: NodeJS.ProcessEnv = process.env): ConfigAcceso {
    return {
        codigoVigenciaS: enteroDeEntorno(entorno, 'PORTAL_CODIGO_VIGENCIA_S', 600, 60),
        codigoIntentos: enteroDeEntorno(entorno, 'PORTAL_CODIGO_INTENTOS', 5, 1),
        codigosPorHora: enteroDeEntorno(entorno, 'PORTAL_CODIGO_MAX_HORA', 5, 1),
        sesionInactividadS: enteroDeEntorno(entorno, 'PORTAL_SESION_INACTIVIDAD_S', 1800, 60),
        sesionMaxS: enteroDeEntorno(entorno, 'PORTAL_SESION_MAX_S', 14400, 60),
    }
}

/** Código de 6 dígitos, uniforme (incluye ceros a la izquierda). */
export function generarCodigo(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function clave(): string {
    const appKey = process.env.APP_KEY
    if (!appKey) throw new Error('APP_KEY no está definida: no se pueden firmar códigos del portal')
    return appKey
}

export function hashCodigo(solicitud: string, codigo: string): string {
    return createHmac('sha256', clave()).update(`${solicitud}:${codigo}`).digest('hex')
}

/** Comparación en tiempo constante del código recibido con el hash guardado. */
export function codigoCoincide(solicitud: string, codigo: string, hashGuardado: string): boolean {
    const recibido = Buffer.from(hashCodigo(solicitud, codigo), 'hex')
    const guardado = Buffer.from(hashGuardado, 'hex')
    return recibido.length === guardado.length && timingSafeEqual(recibido, guardado)
}

export function generarToken(): string {
    return `${PREFIJO_TOKEN}${randomBytes(32).toString('base64url')}`
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

/** `maria.garcia@example.com` → `m***a@e***.com`. */
export function mascararCorreo(correo: string): string {
    const [usuario = '', dominio = ''] = correo.trim().split('@')
    const partes = dominio.split('.')
    const tld = partes.length > 1 ? partes.pop()! : ''
    const nombreDominio = partes.join('.')
    const recortar = (texto: string) =>
        texto.length <= 2 ? `${texto.charAt(0)}***` : `${texto.charAt(0)}***${texto.charAt(texto.length - 1)}`
    const dominioMascarado = `${nombreDominio.charAt(0)}***${tld ? `.${tld}` : ''}`
    return `${recortar(usuario)}@${dominioMascarado}`
}

export function describirDestino(canal: 'correo' | 'telegram', destino: string): string {
    return canal === 'correo' ? mascararCorreo(destino) : 'tu Telegram vinculado'
}
