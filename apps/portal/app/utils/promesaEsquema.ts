import Decimal from 'decimal.js'
import type { CondicionesPromesa } from '~/composables/usePromesas'
import { z } from '~/lib/zod'

type Condiciones = CondicionesPromesa

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * Esquema del formulario de promesa (aparte de `promesa.ts` para que zod no baje con `/corte`: solo
 * con el modal que lo usa).
 */

/**
 * Espejo de `solicitarPromesaValidator` (apps/api/app/portal/validators.ts) más los límites que
 * mostró `GET /portal/promesas/condiciones` (de `limitesPromesa()` de A3): fecha dentro del plazo y,
 * si hay `pago_previo` (abono inicial o deuda vencida sobre el máximo), no se envía: la evaluación
 * de A3 la rechazaría. El cliente no escribe un monto: la promesa cubre todo lo vencido
 * (`contratos/promesas.md`, «Monto y cumplimiento»). Solo ayuda a corregir antes de enviar: la
 * decisión es del backend.
 */
export function esquemaPromesa(
    condiciones: Pick<Condiciones, 'fecha_minima' | 'fecha_maxima'> & Partial<Pick<Condiciones, 'pago_previo'>>,
) {
    const { fecha_minima: minima, fecha_maxima: maxima } = condiciones
    const previo = condiciones.pago_previo && new Decimal(condiciones.pago_previo).greaterThan(0)
        ? condiciones.pago_previo
        : null
    return z.object({
        vence_el: z.string()
            .regex(FECHA, 'Elige el día en que vas a pagar')
            .refine(fecha => !minima || fecha >= minima, 'Esa fecha ya pasó: elige hoy o un día posterior')
            .refine(fecha => !maxima || fecha <= maxima, `Elige una fecha hasta el ${formatearFecha(maxima)}`)
            .refine(() => previo === null, `Primero paga ${formatearQuetzales(previo)}; después solicita la promesa`),
    })
}

export type DatosPromesa = z.output<ReturnType<typeof esquemaPromesa>>
