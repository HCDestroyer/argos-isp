import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { idEntidad } from '#shared/validadores'

/*
|--------------------------------------------------------------------------
| Validadores del conector Horus (A6)
|--------------------------------------------------------------------------
*/

export const configurarHorusValidator = vine.compile(
    vine.object({
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída; 0 si nunca se guardó. 409 si cambió' }),
        activo: vine.boolean().optional(),
        url_base: vine
            .string()
            .trim()
            .maxLength(500)
            .nullable()
            .optional()
            .meta({ description: 'URL base de Horus, solo https (http solo en laboratorio)' }),
        token: vine
            .string()
            .trim()
            .maxLength(200)
            .nullable()
            .optional()
            .meta({ description: 'Código de conexión `hf_pat_…`. Omitido se conserva; null lo borra' }),
        webhook_salida_url: vine
            .string()
            .trim()
            .maxLength(500)
            .nullable()
            .optional()
            .meta({ description: 'URL completa del receptor de Horus (la muestra Horus)' }),
        webhook_salida_secreto: vine
            .string()
            .trim()
            .maxLength(500)
            .nullable()
            .optional()
            .meta({ description: 'Secreto del receptor de Horus. Omitido se conserva; null lo borra' }),
        regenerar_secreto_entrada: vine
            .boolean()
            .optional()
            .meta({ description: 'Genera otro secreto para el receptor de Argos (se muestra una vez)' }),
    }),
)

const idsServicios = () => vine.array(idEntidad()).minLength(1).maxLength(500)

const periodo = {
    mes: vine
        .string()
        .trim()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional()
        .meta({ description: 'Mes `YYYY-MM` (hora de Guatemala); por defecto el actual' }),
    granularidad: vine.enum(['day', 'total'] as const).optional(),
}

export const consumoServicioValidator = vine.compile(vine.object({ ...periodo }))

export const consumoLotesValidator = vine.compile(vine.object({ servicio_ids: idsServicios(), ...periodo }))

export const seguridadLotesValidator = vine.compile(vine.object({ servicio_ids: idsServicios() }))

export const listarEnviosHorusValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine.enum(['pendiente', 'enviado', 'fallido', 'descartado'] as const).optional(),
        evento: vine.string().trim().maxLength(100).optional(),
    }),
)

export const listarRecibidosHorusValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        servicio_id: idEntidad().optional(),
        evento: vine.string().trim().maxLength(100).optional(),
    }),
)

export const canjearEnlaceValidator = vine.compile(
    vine.object({
        codigo: vine.string().trim().minLength(16).maxLength(200),
        sistema: vine.string().trim().maxLength(50),
        base_url: vine.string().trim().maxLength(500),
        token: vine.string().trim().maxLength(500),
        webhook: vine.object({
            url: vine.string().trim().maxLength(500),
            secreto: vine.string().trim().maxLength(500),
        }),
    }),
)

export const conectarConEnlaceValidator = vine.compile(
    vine.object({
        enlace: vine
            .string()
            .trim()
            .maxLength(1000)
            .meta({ description: 'Enlace de conexión de Horus: `https://<horus>/conectar#<codigo>`' }),
    }),
)

export const abrirEnHorusValidator = vine.compile(
    vine.object({
        destino: vine.object({
            tipo: vine.enum(['cliente', 'servicio', 'router', 'hallazgo'] as const),
            id_externo: vine.string().trim().minLength(1).maxLength(100),
        }),
    }),
)
