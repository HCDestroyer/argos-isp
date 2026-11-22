import { createHmac, randomInt } from 'node:crypto'
import env from '#start/env'

/**
 * Código para identificarse en el portal (decisión del PM 19; ficha del servicio, «Generar código»):
 * 6 dígitos de un solo uso que el personal le dicta al cliente cuando el portal no lo reconoce (cambió
 * de equipo o entra desde otra red). Vale `codigo_corte.vigencia_min` minutos (15 de fábrica, 5 a 60,
 * por empresa o global). En la base solo su HMAC con `APP_KEY`; nunca en eventos ni en la auditoría.
 */

export const FORMATO_CODIGO_IDENTIFICACION = /^\d{6}$/

export function generarCodigoIdentificacion(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCodigoIdentificacion(codigo: string): string {
    return createHmac('sha256', env.get('APP_KEY')).update(`codigo_identificacion:${codigo}`).digest('hex')
}

/** Código tal como lo escribió alguien (sin espacios ni guiones), o null si no son 6 dígitos. */
export function normalizarCodigoIdentificacion(valor: unknown): string | null {
    if (typeof valor !== 'string') return null
    const texto = valor.replace(/[\s-]/g, '')
    return FORMATO_CODIGO_IDENTIFICACION.test(texto) ? texto : null
}
