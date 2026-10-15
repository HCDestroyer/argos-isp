import { DateTime } from 'luxon'
import { ValidacionFallida } from '#shared/errores'

/**
 * Fechas contables. Los instantes se guardan en UTC; la **fecha contable** (columna `date`) es el
 * día calendario de Guatemala: un pago a las 20:00 del 31 en Guatemala es del 31, no del 1.
 */

export const ZONA_NEGOCIO = 'America/Guatemala'

/** Día calendario de hoy en Guatemala (YYYY-MM-DD). */
export function hoyGuatemala(ahora: Date = new Date()): string {
    return DateTime.fromJSDate(ahora).setZone(ZONA_NEGOCIO).toISODate()!
}

/** Valida una fecha YYYY-MM-DD y la devuelve normalizada. */
export function fechaValida(valor: string, campo = 'fecha'): string {
    const fecha = DateTime.fromISO(valor, { zone: 'utc' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || !fecha.isValid) {
        throw new ValidacionFallida([{ field: campo, message: 'Fecha inválida (YYYY-MM-DD)', rule: 'fecha' }])
    }
    return fecha.toISODate()!
}

/** Primer día del mes de la fecha (YYYY-MM-01). */
export function inicioDeMes(fecha: string): string {
    return DateTime.fromISO(fecha, { zone: 'utc' }).startOf('month').toISODate()!
}
