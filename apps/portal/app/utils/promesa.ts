import Decimal from 'decimal.js'
import { z } from 'zod'
import type { Schema } from '@argosisp/contracts'

/** Formulario de promesa de pago (tarea 4): esquema, textos de límites e `Idempotency-Key`. */

type Condiciones = Schema<'PortalCondicionesPromesa'>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DINERO = /^\d{1,12}(\.\d{1,2})?$/

/**
 * Espejo de `solicitarPromesaValidator` (apps/api/app/portal/validators.ts) más los límites que
 * mostró `GET /portal/promesas/condiciones` (de `limitesPromesa()` de A3): fecha dentro del plazo,
 * monto hasta la deuda y, si hay `pago_previo` (abono inicial o deuda vencida sobre el máximo), no
 * se envía: la evaluación de A3 la rechazaría. Solo ayuda a corregir antes de enviar: la decisión
 * es del backend.
 */
export function esquemaPromesa(
    condiciones: Pick<Condiciones, 'fecha_minima' | 'fecha_maxima' | 'monto_maximo'> & Partial<Pick<Condiciones, 'pago_previo'>>,
) {
    const { fecha_minima: minima, fecha_maxima: maxima, monto_maximo: maximo } = condiciones
    const previo = condiciones.pago_previo && new Decimal(condiciones.pago_previo).greaterThan(0)
        ? condiciones.pago_previo
        : null
    return z.object({
        vence_el: z.string()
            .regex(FECHA, 'Elige el día en que vas a pagar')
            .refine(fecha => !minima || fecha >= minima, 'Esa fecha ya pasó: elige hoy o un día posterior')
            .refine(fecha => !maxima || fecha <= maxima, `Elige una fecha hasta el ${formatearFecha(maxima)}`),
        monto: z.string().trim()
            .regex(DINERO, 'Escribe el monto con hasta 2 decimales, sin la Q')
            .refine(monto => !DINERO.test(monto) || new Decimal(monto).greaterThan(0), 'Escribe un monto mayor que Q 0.00')
            .refine(
                monto => !maximo || !DINERO.test(monto) || new Decimal(monto).lessThanOrEqualTo(maximo),
                `El monto no puede pasar de ${formatearQuetzales(maximo)}: escribe esa cantidad o menos`,
            )
            .refine(() => previo === null, `Primero paga ${formatearQuetzales(previo)}; después solicita la promesa`),
    })
}

/**
 * Por qué hay que pagar antes de prometer. El abono ya está en la lista de límites; aquí se agrega
 * solo lo que la lista no dice: que el saldo vencido pasa del máximo.
 */
export function textoPagoPrevio(condiciones: Pick<Condiciones, 'deuda_maxima'>): string {
    const partes: string[] = []
    const deuda = condiciones.deuda_maxima
    if (deuda && new Decimal(deuda.faltante).greaterThan(0)) {
        partes.push(`Tu saldo vencido (${montoEnTexto(deuda.vencida)}) pasa del máximo para una promesa (${montoEnTexto(deuda.maximo)}).`)
    }
    partes.push('Paga en línea, en la oficina o por depósito y luego solicita la promesa.')
    return partes.join(' ')
}

export type DatosPromesa = z.output<ReturnType<typeof esquemaPromesa>>

/**
 * Monto dentro de una frase: `Q 318.33` con espacio duro, para que la "Q" no quede sola al final
 * de una línea en el teléfono.
 */
export function montoEnTexto(monto: string | null | undefined): string {
    return formatearQuetzales(monto).replace(' ', '\u00A0')
}

/** "hasta 3 días (a más tardar el 19/10/2026)". */
export function textoPlazo(condiciones: Pick<Condiciones, 'plazo_max_dias' | 'fecha_maxima'>): string | null {
    if (!condiciones.fecha_maxima) {
        return null
    }
    const dias = condiciones.plazo_max_dias
    const plazo = dias === null ? '' : dias === 1 ? 'hasta 1 día ' : `hasta ${dias} días `
    return `${plazo}(a más tardar el ${formatearFecha(condiciones.fecha_maxima)})`.trim()
}

/**
 * UUID v4 para `Idempotency-Key`. `crypto.randomUUID()` solo existe en contextos seguros (HTTPS) y
 * la página de corte se abre por HTTP; `getRandomValues` sí está siempre.
 */
export function claveIdempotencia(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0F) | 0x40
    bytes[8] = (bytes[8]! & 0x3F) | 0x80
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
