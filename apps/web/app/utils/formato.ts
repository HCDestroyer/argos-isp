import Decimal from 'decimal.js'

/** Zona horaria de presentación. La base de datos y la API trabajan en UTC. */
export const ZONA_HORARIA = 'America/Guatemala'
const LOCALE = 'es-GT'

type FechaEntrada = string | Date | null | undefined

const formatoFecha = new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA_HORARIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
})

const formatoFechaHora = new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA_HORARIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
})

/** Fecha "solo día" (`2026-10-19`): se muestra tal cual, sin moverla por zona horaria. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

function aDate(valor: FechaEntrada): Date | null {
    if (valor === null || valor === undefined || valor === '') {
        return null
    }
    const fecha = valor instanceof Date ? valor : new Date(valor)
    return Number.isNaN(fecha.getTime()) ? null : fecha
}

/** `2026-10-19T15:00:00Z` → `19/10/2026` en hora de Guatemala. `—` si no hay fecha válida. */
export function formatearFecha(valor: FechaEntrada): string {
    if (typeof valor === 'string') {
        const soloFecha = SOLO_FECHA.exec(valor)
        if (soloFecha) {
            return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`
        }
    }
    const fecha = aDate(valor)
    return fecha ? formatoFecha.format(fecha) : '—'
}

/** `2026-10-19T15:00:00Z` → `19/10/2026, 09:00` en hora de Guatemala. */
export function formatearFechaHora(valor: FechaEntrada): string {
    const fecha = aDate(valor)
    return fecha ? formatoFechaHora.format(fecha) : '—'
}

const formatoHora = new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA_HORARIA,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
})

/** `2026-10-19T15:42:00Z` → `09:42` en hora de Guatemala (frescura de un dato en vivo). */
export function formatearHora(valor: FechaEntrada): string {
    const fecha = aDate(valor)
    return fecha ? formatoHora.format(fecha) : '—'
}

/** Agrupa miles con coma: `1234567` → `1,234,567`. */
function agruparMiles(entero: string): string {
    return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Monto en quetzales: `'1234.5'` → `Q 1,234.50`; `'-20'` → `-Q 20.00`.
 * Recibe el string decimal de la API (o un `Decimal`); nunca `number`.
 * Redondea a centavos con mitad hacia arriba. `—` si el valor no es un número.
 */
export function formatearQuetzales(monto: string | Decimal | null | undefined): string {
    if (monto === null || monto === undefined || monto === '') {
        return '—'
    }
    let valor: Decimal
    try {
        valor = monto instanceof Decimal ? monto : new Decimal(monto.trim())
    }
    catch {
        return '—'
    }
    if (!valor.isFinite()) {
        return '—'
    }
    const redondeado = valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    const [entero = '0', centavos = '00'] = redondeado.abs().toFixed(2).split('.')
    const signo = redondeado.isNegative() && !redondeado.isZero() ? '-' : ''
    return `${signo}Q ${agruparMiles(entero)}.${centavos}`
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** `2026-12-05` → `5 dic` (contadores de la ficha). Con otro año que el actual, `5 dic 2027`. `—` si no hay fecha. */
export function formatearFechaCorta(valor: FechaEntrada, hoy: Date = new Date()): string {
    let anio: number
    let mes: number
    let dia: number
    const soloFecha = typeof valor === 'string' ? SOLO_FECHA.exec(valor) : null
    if (soloFecha) {
        anio = Number(soloFecha[1])
        mes = Number(soloFecha[2])
        dia = Number(soloFecha[3])
    }
    else {
        const fecha = aDate(valor)
        if (!fecha) {
            return '—'
        }
        const [d, m, a] = formatoFecha.format(fecha).split('/').map(Number)
        dia = d!
        mes = m!
        anio = a!
    }
    const anioHoy = Number(formatoFecha.format(hoy).split('/')[2])
    return `${dia} ${MESES_CORTOS[mes - 1]}${anio === anioHoy ? '' : ` ${anio}`}`
}

/** `2023-03-14T…` → `mar 2023` (cliente desde). */
export function formatearMesAnio(valor: FechaEntrada): string {
    const fecha = aDate(valor)
    if (!fecha) {
        return '—'
    }
    const [, mes, anio] = formatoFecha.format(fecha).split('/').map(Number)
    return `${MESES_CORTOS[mes! - 1]} ${anio}`
}
