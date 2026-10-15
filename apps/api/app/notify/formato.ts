import { Decimal } from 'decimal.js'
import { DateTime } from 'luxon'

/** Zona en la que se muestran fechas al cliente. En base de datos todo es UTC. */
export const ZONA = 'America/Guatemala'

/** "1234.5" → "Q 1,234.50" */
export function quetzales(cantidad: string | number | Decimal | null | undefined): string {
    const valor = new Decimal(cantidad ?? 0).toDecimalPlaces(2)
    const [entero, decimales] = valor.abs().toFixed(2).split('.') as [string, string]
    const conComas = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${valor.isNegative() ? '-' : ''}Q ${conComas}.${decimales}`
}

/** Monto como string con 2 decimales: "150.00" */
export function monto(valor: string | number | Decimal | null | undefined): string {
    return new Decimal(valor ?? 0).toFixed(2)
}

/** Fecha calendario (YYYY-MM-DD o Date de Postgres) → DateTime al inicio del día en Guatemala. */
export function fechaCalendario(valor: string | Date): DateTime {
    if (valor instanceof Date) {
        // `date` de Postgres llega como Date a medianoche local del proceso: usar sus componentes.
        return DateTime.fromObject(
            { year: valor.getFullYear(), month: valor.getMonth() + 1, day: valor.getDate() },
            { zone: ZONA },
        )
    }
    return DateTime.fromISO(valor.slice(0, 10), { zone: ZONA })
}

export function fechaCorta(fecha: DateTime): string {
    return fecha.setZone(ZONA).setLocale('es').toFormat('dd/MM/yyyy')
}

export function fechaHora(instante: string | Date): string {
    const dt = instante instanceof Date ? DateTime.fromJSDate(instante) : DateTime.fromISO(instante)
    return dt.setZone(ZONA).setLocale('es').toFormat('dd/MM/yyyy HH:mm')
}

/** "octubre 2026" */
export function mesAnio(fecha: DateTime): string {
    return fecha.setLocale('es').toFormat('LLLL yyyy')
}

export function isoFecha(fecha: DateTime): string {
    return fecha.toISODate() ?? ''
}

/** Días calendario (Guatemala) de `desde` a `hasta`; negativo si `hasta` ya pasó. */
export function diasEntre(desde: DateTime, hasta: DateTime): number {
    const a = desde.setZone(ZONA).startOf('day')
    const b = hasta.setZone(ZONA).startOf('day')
    return Math.round(b.diff(a, 'days').days)
}
