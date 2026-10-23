import logger from '@adonisjs/core/services/logger'
import { Problema, type ProblemaJson } from '#shared/errores'

/**
 * Bloques independientes del tablero y del comparador (fase 8, contrato §9.4 y §22): cada uno se
 * calcula por separado y, si falla, devuelve su problema RFC 9457 sin cifras (regla 12), sin tumbar
 * los demás. Un bloque que no corresponde va con `no_aplica` y su motivo.
 */

export type EstadoBloque = 'ok' | 'error' | 'no_aplica'

export interface Bloque<T = Record<string, unknown>> {
    estado: EstadoBloque
    /** por qué no aplica (régimen) o, con `ok`, null */
    motivo: string | null
    /** el problema RFC 9457 del bloque cuando `estado = error` */
    error: ProblemaJson | null
    datos: T | null
}

export class NoAplica extends Error {
    constructor(readonly motivo: string) {
        super(motivo)
    }
}

export async function calcularBloque<T extends Record<string, unknown>>(
    empresaId: number,
    nombre: string,
    calculo: () => Promise<T>,
): Promise<Bloque> {
    try {
        return { estado: 'ok', motivo: null, error: null, datos: await calculo() }
    } catch (error) {
        if (error instanceof NoAplica) {
            return { estado: 'no_aplica', motivo: error.motivo, error: null, datos: null }
        }
        if (error instanceof Problema) {
            return { estado: 'error', motivo: null, error: error.toJSON(), datos: null }
        }
        logger.error({ err: error, empresa_id: empresaId, bloque: nombre }, 'tablero fiscal')
        return {
            estado: 'error',
            motivo: null,
            error: new Problema(
                500,
                'error_interno',
                'Error interno',
                `El bloque ${nombre} no se pudo calcular; los demás bloques sí`,
            ).toJSON(),
            datos: null,
        }
    }
}
