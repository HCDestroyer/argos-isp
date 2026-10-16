import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, fechaIso, idEntidad } from '#shared/validadores'

export const abrirCajaValidator = vine.compile(vine.object({ fondo_inicial: dinero() }))

export const cerrarCajaValidator = vine.compile(
    vine.object({
        contado: dinero(),
        motivo: vine
            .string()
            .trim()
            .minLength(3)
            .maxLength(500)
            .nullable()
            .optional()
            .meta({ description: 'Obligatorio si hay diferencia entre esperado y contado' }),
    }),
)

export const listarTurnosValidator = vine.compile(vine.object({ ...reglasPaginacion }))

export const diarioValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
        origen_tipo: vine
            .enum(['factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste'] as const)
            .optional(),
        origen_id: idEntidad()
            .optional()
            .meta({ description: 'Asientos de este origen (con origen_tipo: la factura, el pago…)' }),
    }),
)

export const mayorValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cuenta_id: idEntidad(),
        cliente_id: idEntidad().optional().meta({ description: 'Auxiliar de un cliente' }),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
    }),
)
