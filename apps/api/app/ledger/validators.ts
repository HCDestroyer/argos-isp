import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, fechaIso, idEntidad, motivo } from '#shared/validadores'
import { CLAVES_CATEGORIA_EGRESO } from '#ledger/plan_cuentas'
import { METODOS_EGRESO } from '#ledger/egresos'

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

/*
|--------------------------------------------------------------------------
| Egresos
|--------------------------------------------------------------------------
*/

export const registrarEgresoValidator = vine.compile(
    vine.object({
        categoria: vine
            .enum(CLAVES_CATEGORIA_EGRESO)
            .meta({ description: 'Categoría (GET /egresos/categorias)' }),
        monto: dinero(),
        metodo: vine.enum(METODOS_EGRESO).meta({
            description:
                'De dónde sale el dinero: caja (efectivo), banco (del libro) o cuenta_bancaria propia',
        }),
        fecha: fechaIso().optional().meta({ description: 'Fecha contable (por defecto hoy; no futura)' }),
        caja_id: idEntidad().nullable().optional().meta({
            description: 'Con caja; sin ella, la del turno abierto del usuario o la principal',
        }),
        banco_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'Con banco; por defecto el banco principal' }),
        cuenta_bancaria_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'Obligatoria con cuenta_bancaria (GET /cuentas-bancarias)' }),
        proveedor: vine.string().trim().maxLength(150).nullable().optional(),
        descripcion: vine.string().trim().maxLength(500).nullable().optional(),
        comprobante: vine
            .string()
            .trim()
            .maxLength(100)
            .nullable()
            .optional()
            .meta({ description: 'Número o serie del documento del proveedor (opcional)' }),
    }),
)

export const anularEgresoValidator = vine.compile(vine.object({ motivo: motivo() }))

export const listarEgresosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
        categoria: vine.enum(CLAVES_CATEGORIA_EGRESO).optional(),
        metodo: vine.enum(METODOS_EGRESO).optional(),
        estado: vine.enum(['registrado', 'anulado'] as const).optional(),
        caja_id: idEntidad().optional(),
        cuenta_bancaria_id: idEntidad().optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Cierre mensual
|--------------------------------------------------------------------------
*/

const periodo = {
    anio: vine.number().withoutDecimals().range([2000, 2100]),
    mes: vine.number().withoutDecimals().range([1, 12]),
}

export const cerrarPeriodoValidator = vine.compile(vine.object(periodo))

export const reabrirPeriodoValidator = vine.compile(vine.object({ ...periodo, motivo: motivo() }))

export const listarCierresValidator = vine.compile(
    vine.object({ ...reglasPaginacion, estado: vine.enum(['cerrado', 'reabierto'] as const).optional() }),
)
