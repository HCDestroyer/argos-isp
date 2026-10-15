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
