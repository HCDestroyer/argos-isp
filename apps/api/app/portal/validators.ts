import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { versionEsperada } from '#shared/validadores'

/**
 * Validadores del portal del cliente (A5). Espejo en `apps/portal` (esquemas de `UForm`).
 */

export const solicitarCodigoValidator = vine.compile(
    vine.object({
        identificador: vine
            .string()
            .trim()
            .minLength(2)
            .maxLength(64)
            .optional()
            .meta({ description: 'NIT/CUI o usuario PPPoE. Omitir con `por_ip: true`' }),
        por_ip: vine
            .boolean()
            .optional()
            .meta({ description: 'Identificar por la IP de origen (página de corte)' }),
    }),
)

export const verificarCodigoValidator = vine.compile(
    vine.object({
        solicitud: vine.string().trim().uuid().meta({ description: 'Devuelta por POST /portal/codigo' }),
        codigo: vine
            .string()
            .trim()
            .regex(/^\d{6}$/)
            .meta({ description: 'Código de 6 dígitos' }),
    }),
)

export const paginaPortalValidator = vine.compile(vine.object({ ...reglasPaginacion }))

/** Teléfono guatemalteco o internacional: dígitos, espacios, guiones, paréntesis y `+`. */
const telefono = () =>
    vine
        .string()
        .trim()
        .maxLength(30)
        .regex(/^\+?[\d\s()-]{7,30}$/)

export const editarPlantillaDocumentoValidator = vine.compile(
    vine.object({
        html: vine.string().minLength(1).maxLength(100_000),
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída (0 si es la de fábrica); si cambió responde 409' }),
    }),
)

export const vistaPreviaDocumentoValidator = vine.compile(
    vine.object({ html: vine.string().minLength(1).maxLength(100_000) }),
)

export const editarContactoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        email: vine.string().trim().email().maxLength(200).nullable().optional(),
        telefono: telefono().nullable().optional(),
        movil: telefono().nullable().optional(),
        canal_preferido: vine.enum(['correo', 'telegram', 'whatsapp'] as const).optional(),
    }),
)
