import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { idEntidad, versionEsperada } from '#shared/validadores'

/*
|--------------------------------------------------------------------------
| Validadores del módulo notify (A6)
|--------------------------------------------------------------------------
*/

export const editarPlantillaNotificacionValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        asunto: vine
            .string()
            .trim()
            .maxLength(300)
            .nullable()
            .optional()
            .meta({ description: 'Asunto Mustache (solo correo; en Telegram va como primera línea)' }),
        cuerpo: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(4000)
            .optional()
            .meta({ description: 'Cuerpo Mustache en texto plano' }),
        activa: vine.boolean().optional(),
    }),
)

export const listarEnviosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        evento: vine.string().trim().maxLength(100).optional(),
        canal: vine.enum(['correo', 'telegram', 'whatsapp'] as const).optional(),
        estado: vine.enum(['encolado', 'enviado', 'fallido'] as const).optional(),
    }),
)

export const editarRecordatorioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        dias: vine.number().withoutDecimals().range([-60, 60]).optional().meta({
            description: 'Días respecto al vencimiento: negativo antes, 0 el día, positivo después',
        }),
        hora: vine
            .string()
            .trim()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional()
            .meta({ description: 'HH:MM, hora de Guatemala' }),
        activo: vine.boolean().optional(),
    }),
)
