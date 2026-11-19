import Decimal from 'decimal.js'
import { z } from '~/lib/zod'
import { pideBancoOrigen, problemaArchivo } from '~/utils/comprobante'

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DINERO = /^\d{1,12}(\.\d{1,2})?$/

/**
 * Esquema del formulario de comprobante (aparte de `comprobante.ts` para que zod no baje con
 * `/corte`: solo con el modal que lo usa).
 */

/**
 * Espejo de `subirComprobanteValidator` (apps/api/app/portal/validators.ts) más el archivo.
 * `hoy` es la fecha de Guatemala (YYYY-MM-DD): el depósito no puede ser posterior.
 */
export function esquemaComprobante(hoy: string) {
    return z.object({
        metodo: z.enum(['deposito', 'transferencia', 'ach', 'remesa'], { error: 'Elige cómo pagaste' }),
        cuenta_bancaria_id: z.number({ error: 'Elige la cuenta a la que depositaste' }).int().positive(),
        banco_origen_id: z.number().int().positive().optional(),
        referencia: z.string().trim()
            .min(1, 'Escribe el número de referencia o de boleta')
            .max(100, 'Escribe la referencia con 100 caracteres o menos'),
        monto: z.string().trim()
            .regex(DINERO, 'Escribe el monto con hasta 2 decimales, sin la Q')
            .refine(monto => !DINERO.test(monto) || new Decimal(monto).greaterThan(0), 'Escribe un monto mayor que Q 0.00'),
        fecha_deposito: z.string()
            .regex(FECHA, 'Elige la fecha en que pagaste')
            .refine(fecha => fecha <= hoy, 'La fecha del pago no puede ser posterior a hoy: elige hoy o un día anterior'),
        archivo: z.instanceof(File, { error: 'Adjunta la foto o el PDF del comprobante' })
            .superRefine((archivo, ctx) => {
                const problema = problemaArchivo(archivo)
                if (problema) {
                    ctx.addIssue({ code: 'custom', message: problema })
                }
            }),
    }).superRefine((datos, ctx) => {
        if (pideBancoOrigen(datos.metodo) && !datos.banco_origen_id) {
            ctx.addIssue({ code: 'custom', path: ['banco_origen_id'], message: 'Elige el banco desde el que transferiste' })
        }
    })
}

export type DatosComprobante = z.output<ReturnType<typeof esquemaComprobante>>
