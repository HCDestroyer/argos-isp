import vine from '@vinejs/vine'
import '#shared/vine_meta'
import { instanteIso } from '#shared/validadores'
import { reglasPaginacion } from '#shared/paginacion'
import { LIMITE_MAXIMO_REGISTRO, NIVELES, ORIGENES } from '#monitoreo/registro'

/** Query de `GET /sistema/registro` (contrato `salud.md` §3.1). */
export const registroSistemaValidator = vine.compile(
    vine.object({
        nivel: vine.enum(NIVELES).optional(),
        origen: vine.enum(ORIGENES).optional(),
        desde: instanteIso().optional().meta({ description: 'ISO 8601; por defecto hace 7 días, máximo 31' }),
        cursor: vine.string().trim().maxLength(400).optional(),
        limit: vine.number().withoutDecimals().range([1, LIMITE_MAXIMO_REGISTRO]).optional(),
    }),
)

/** Query de `GET /sistema/crons/:clave/corridas`. */
export const corridasCronValidator = vine.compile(vine.object({ ...reglasPaginacion }))
