import Decimal from 'decimal.js'
import { z } from 'zod'
import type { Schema } from '@argosisp/contracts'

/** Formulario de promesa de pago (tarea 4): esquema, textos de límites e `Idempotency-Key`. */

type Condiciones = Schema<'PortalCondicionesPromesa'>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DINERO = /^\d{1,12}(\.\d{1,2})?$/

/**
 * Espejo de `solicitarPromesaValidator` (apps/api/app/portal/validators.ts) más los límites que
 * mostró `GET /portal/promesas/condiciones`. Solo ayuda a corregir antes de enviar: la decisión es
 * del backend.
 */
export function esquemaPromesa(condiciones: Pick<Condiciones, 'fecha_minima' | 'fecha_maxima' | 'monto_maximo'>) {
    const { fecha_minima: minima, fecha_maxima: maxima, monto_maximo: maximo } = condiciones
    return z.object({
        vence_el: z.string()
            .regex(FECHA, 'Elige una fecha')
            .refine(fecha => !minima || fecha >= minima, 'La fecha ya pasó')
            .refine(fecha => !maxima || fecha <= maxima, `La fecha no puede pasar del ${formatearFecha(maxima)}`),
        monto: z.string().trim()
            .regex(DINERO, 'Escribe el monto con hasta 2 decimales, sin la Q')
            .refine(monto => !DINERO.test(monto) || new Decimal(monto).greaterThan(0), 'El monto debe ser mayor que 0')
            .refine(
                monto => !maximo || !DINERO.test(monto) || new Decimal(monto).lessThanOrEqualTo(maximo),
                `El monto no puede pasar de ${formatearQuetzales(maximo)}`,
            ),
    })
}

export type DatosPromesa = z.output<ReturnType<typeof esquemaPromesa>>

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
