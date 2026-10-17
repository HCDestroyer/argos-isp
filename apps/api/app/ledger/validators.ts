import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo } from '#shared/validadores'
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

export const listarCajasValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

export const crearCajaValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(80),
        cajero_id: idEntidad().nullable().optional().meta({ description: 'Cajero asignado (opcional)' }),
        empresa_id: idEntidad().nullable().optional().meta({
            description: 'Empresa de la caja; por defecto la activa (X-Empresa-Id)',
        }),
    }),
)

/** Consultas del libro: la empresa activa o el consolidado. */
export const libroEmpresasValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

export const balanceValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        hasta: fechaIso().optional().meta({ description: 'Saldos al día (por defecto hoy, Guatemala)' }),
    }),
)

export const estadoResultadosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        desde: fechaIso().optional().meta({ description: 'Por defecto el día 1 del mes de hasta' }),
        hasta: fechaIso().optional().meta({ description: 'Por defecto hoy (Guatemala)' }),
    }),
)

export const integridadValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        desde: fechaIso().optional().meta({
            description: 'Recalcula el hash de los asientos con fecha desde este día (sin rango, todos)',
        }),
        hasta: fechaIso().optional().meta({ description: 'Hasta este día (inclusive)' }),
    }),
)

export const diarioValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
        origen_tipo: vine
            .enum([
                'factura',
                'pago',
                'mora',
                'nota_credito',
                'egreso',
                'cierre_caja',
                'ajuste',
                'reclasificacion',
            ] as const)
            .optional(),
        origen_id: idEntidad()
            .optional()
            .meta({ description: 'Asientos de este origen (con origen_tipo: la factura, el pago…)' }),
    }),
)

export const mayorValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
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

export const revertirAsientoValidator = vine.compile(
    vine.object({
        motivo: motivo(),
        fecha: fechaIso().optional().meta({
            description:
                'Fecha contable del reverso (por defecto hoy). No anterior al original ni en un mes cerrado',
        }),
    }),
)

export const listarEgresosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
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
    empresa_id: idEntidad().nullable().optional().meta({
        description: 'Empresa cuyo libro se cierra o reabre; por defecto la activa (X-Empresa-Id)',
    }),
    anio: vine.number().withoutDecimals().range([2000, 2100]),
    mes: vine.number().withoutDecimals().range([1, 12]),
}

export const cerrarPeriodoValidator = vine.compile(vine.object(periodo))

export const reabrirPeriodoValidator = vine.compile(vine.object({ ...periodo, motivo: motivo() }))

export const listarCierresValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        empresas: empresasConsulta(),
        estado: vine.enum(['cerrado', 'reabierto'] as const).optional(),
    }),
)
