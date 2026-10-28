import * as z from 'zod'
import { es } from 'zod/v4/locales'

/**
 * Mensajes de validación por defecto del panel: en español y diciendo qué hacer. Solo se usan cuando
 * el esquema no trae su propio mensaje (los mensajes escritos en cada esquema siempre ganan).
 * Lo que no se reconoce cae al idioma español de zod.
 */
type Problema = z.core.$ZodRawIssue

function vacio(valor: unknown): boolean {
    return valor === undefined || valor === null || valor === '' || (typeof valor === 'number' && Number.isNaN(valor))
}

function cantidad(valor: number | bigint): string {
    return Number(valor).toLocaleString('es-GT')
}

export function mensajeValidacion(problema: Problema): string | undefined {
    switch (problema.code) {
        case 'invalid_type':
            if (vacio(problema.input)) {
                return problema.expected === 'number' || problema.expected === 'int' || problema.expected === 'bigint'
                    ? 'Este dato es obligatorio: elige una opción o escribe un número'
                    : 'Este dato es obligatorio: complétalo para continuar'
            }
            if (problema.expected === 'number' || problema.expected === 'int') {
                return 'Escribe solo números'
            }
            if (problema.expected === 'date') {
                return 'Elige una fecha válida'
            }
            return 'Revisa este dato: el valor no tiene el formato esperado'
        case 'too_small':
            if (problema.origin === 'string') {
                return Number(problema.minimum) <= 1
                    ? 'Este dato es obligatorio: complétalo para continuar'
                    : `Escribe al menos ${cantidad(problema.minimum)} caracteres`
            }
            if (problema.origin === 'array' || problema.origin === 'set') {
                return Number(problema.minimum) <= 1 ? 'Elige al menos una opción' : `Elige al menos ${cantidad(problema.minimum)} opciones`
            }
            if (problema.origin === 'number' || problema.origin === 'int' || problema.origin === 'bigint') {
                if (Number(problema.minimum) === 0 && !problema.inclusive) {
                    return 'Escribe un número mayor que 0'
                }
                return problema.inclusive ? `Escribe un número de ${cantidad(problema.minimum)} o más` : `Escribe un número mayor que ${cantidad(problema.minimum)}`
            }
            return undefined
        case 'too_big':
            if (problema.origin === 'string') {
                return `Acorta el texto: máximo ${cantidad(problema.maximum)} caracteres`
            }
            if (problema.origin === 'array' || problema.origin === 'set') {
                return `Elige como máximo ${cantidad(problema.maximum)}`
            }
            if (problema.origin === 'number' || problema.origin === 'int' || problema.origin === 'bigint') {
                return problema.inclusive ? `Escribe un número de ${cantidad(problema.maximum)} o menos` : `Escribe un número menor que ${cantidad(problema.maximum)}`
            }
            return undefined
        case 'invalid_format':
            if (problema.format === 'email') {
                return 'Escribe un correo válido, como nombre@dominio.com'
            }
            if (problema.format === 'url') {
                return 'Escribe una dirección web completa, que empiece con https://'
            }
            if (problema.format === 'ipv4') {
                return 'Escribe una IPv4 como 100.64.10.50'
            }
            if (problema.format === 'date' || problema.format === 'datetime') {
                return 'Elige una fecha válida'
            }
            return 'Revisa el formato de este dato'
        case 'invalid_value':
        case 'invalid_union':
            return 'Elige una de las opciones de la lista'
        case 'not_multiple_of':
            return problema.divisor === 0.01 ? 'Usa como máximo dos decimales' : `Escribe un múltiplo de ${problema.divisor}`
        default:
            return undefined
    }
}

const espanol = es()

/** Se aplica una vez al arrancar (plugin `zod`); las pruebas lo llaman en su preparación. */
export function configurarMensajesValidacion() {
    z.config({
        localeError: espanol.localeError,
        customError: mensajeValidacion,
    })
}
