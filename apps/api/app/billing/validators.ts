import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, fechaIso, idEntidad, instanteIso, motivo, versionEsperada } from '#shared/validadores'
import { reglasPromesaSchema } from '#billing/reglas_promesa'

/*
|--------------------------------------------------------------------------
| Plantillas de facturación
|--------------------------------------------------------------------------
*/

const camposPlantilla = {
    nombre: vine.string().trim().minLength(2).maxLength(100),
    ciclo: vine.enum(['dia_fijo', 'aniversario'] as const),
    dia: vine.number().withoutDecimals().range([1, 28]).nullable().optional(),
    prorrateo: vine.boolean().optional(),
    dias_gracia: vine.number().withoutDecimals().range([0, 90]).optional(),
    facturas_para_limitar: vine.number().withoutDecimals().range([0, 24]).optional(),
    facturas_para_cortar: vine.number().withoutDecimals().range([1, 24]).optional(),
    mora_tipo: vine.enum(['ninguna', 'fija', 'porcentaje'] as const).optional(),
    mora_valor: dinero().optional(),
    mora_recurrente: vine.boolean().optional(),
    hora_corte: vine
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .meta({ description: 'HH:MM hora de Guatemala' }),
    certificar_al: vine.enum(['emitir', 'pagar', 'nunca'] as const).optional(),
    reglas_promesa: reglasPromesaSchema()
        .optional()
        .meta({ description: 'Reglas de promesas; las claves que falten toman su valor por defecto' }),
}

export const crearPlantillaValidator = vine.compile(vine.object(camposPlantilla))

export const editarPlantillaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposPlantilla.nombre.optional(),
        ciclo: vine.enum(['dia_fijo', 'aniversario'] as const).optional(),
        dia: vine.number().withoutDecimals().range([1, 28]).nullable().optional(),
        prorrateo: vine.boolean().optional(),
        dias_gracia: vine.number().withoutDecimals().range([0, 90]).optional(),
        facturas_para_limitar: vine.number().withoutDecimals().range([0, 24]).optional(),
        facturas_para_cortar: vine.number().withoutDecimals().range([1, 24]).optional(),
        mora_tipo: vine.enum(['ninguna', 'fija', 'porcentaje'] as const).optional(),
        mora_valor: dinero().optional(),
        mora_recurrente: vine.boolean().optional(),
        hora_corte: vine
            .string()
            .trim()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional(),
        certificar_al: vine.enum(['emitir', 'pagar', 'nunca'] as const).optional(),
        reglas_promesa: reglasPromesaSchema().optional().meta({
            description:
                'Si se envía, reemplaza el objeto completo (lo que falte vuelve al valor por defecto)',
        }),
    }),
)

/*
|--------------------------------------------------------------------------
| Facturas
|--------------------------------------------------------------------------
*/

export const listarFacturasValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        estado: vine.enum(['emitida', 'parcial', 'pagada', 'vencida', 'anulada'] as const).optional(),
        periodo: fechaIso().optional(),
    }),
)

export const generarFacturasValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad()
            .optional()
            .meta({ description: 'Solo este servicio; si falta, todos los pendientes' }),
        hasta: fechaIso()
            .optional()
            .meta({ description: 'Genera todo lo pendiente hasta esta fecha (por defecto hoy)' }),
    }),
)

export const vencerFacturasValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad()
            .optional()
            .meta({ description: 'Solo las facturas de este servicio; si falta, todas' }),
        hasta: fechaIso().optional().meta({
            description:
                'Día de referencia: vence lo que venció antes de esta fecha (por defecto hoy). Una fecha futura fuerza el vencimiento en el laboratorio',
        }),
    }),
)

export const corteValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad()
            .optional()
            .meta({ description: 'Solo este servicio; si falta, las horas de corte pendientes de hoy' }),
        ignorar_hora: vine
            .boolean()
            .optional()
            .meta({ description: 'Baja de estado aunque no haya llegado la hora de corte (laboratorio)' }),
    }),
)

export const anularFacturaValidator = vine.compile(vine.object({ motivo: motivo() }))

/*
|--------------------------------------------------------------------------
| Pagos
|--------------------------------------------------------------------------
*/

export const listarPagosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        caja_id: idEntidad().optional(),
        metodo: vine.enum(['caja', 'pasarela', 'deposito', 'agente', 'debito'] as const).optional(),
        estado: vine.enum(['registrado', 'pendiente_verificacion', 'anulado'] as const).optional(),
        desde: instanteIso().optional(),
        hasta: instanteIso().optional(),
    }),
)

export const registrarPagoValidator = vine.compile(
    vine.object({
        cliente_id: idEntidad(),
        metodo: vine.enum(['caja', 'pasarela', 'deposito', 'agente', 'debito'] as const),
        monto: dinero(),
        referencia: vine.string().trim().maxLength(100).nullable().optional(),
        caja_id: idEntidad().nullable().optional().meta({ description: 'Obligatoria con metodo caja' }),
        nota: vine.string().trim().maxLength(500).nullable().optional(),
        facturas: vine
            .array(idEntidad())
            .optional()
            .meta({ description: 'Facturas a las que aplicar; por defecto la más antigua primero' }),
    }),
)

export const anularPagoValidator = vine.compile(vine.object({ motivo: motivo() }))

/*
|--------------------------------------------------------------------------
| Promesas
|--------------------------------------------------------------------------
*/

export const listarPromesasValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        servicio_id: idEntidad().optional(),
        cliente_id: idEntidad().optional(),
        estado: vine
            .enum([
                'activa',
                'cumplida',
                'incumplida',
                'cancelada',
                'pendiente_aprobacion',
                'rechazada',
            ] as const)
            .optional(),
    }),
)

export const crearPromesaValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad(),
        vence_en: instanteIso(),
        monto: dinero(),
        canal: vine.enum(['portal', 'ia', 'operador', 'supervisor'] as const).optional(),
    }),
)

export const aprobarPromesaValidator = vine.compile(
    vine.object({ nota: vine.string().trim().maxLength(500).nullable().optional() }),
)
