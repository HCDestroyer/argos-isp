import vine from '@vinejs/vine'
import { idEntidad, instanteIso, versionEsperada } from '#shared/validadores'

/**
 * Validadores de «De la venta a la instalación» (contrato Iris 0.10.0 §3.4). `version` es opcional
 * en todas (una versión leída al encolar queda vieja); si llega y no coincide, 409.
 */

export const origenTipo = () =>
    vine
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{1,39}$/)
        .meta({ description: 'Sistema y documento que lo pide: `iris_orden`' })

export const origenId = () =>
    vine.string().trim().minLength(1).maxLength(100).meta({ description: 'Id de la orden de Iris' })

export const versionOpcional = () =>
    versionEsperada()
        .optional()
        .meta({ description: 'Opcional (§3.4): si viene y no coincide, 409 conflicto_version' })

export const reservarIpValidator = vine.compile(
    vine.object({
        router_id: idEntidad().optional().meta({
            description:
                'Router final; si es otro, el servicio pasa a él antes de reservar (el plan debe estar asignado)',
        }),
        origen_tipo: origenTipo(),
        origen_id: origenId(),
    }),
)

export const cambiarPlanPendienteValidator = vine.compile(
    vine.object({
        plan_id: idEntidad(),
        motivo: vine.enum(['mas_velocidad', 'menos_velocidad', 'otro'] as const),
        motivo_texto: vine.string().trim().minLength(3).maxLength(500).optional().meta({
            description: 'Obligatorio con motivo otro; queda solo en la auditoría',
        }),
        version: versionOpcional(),
        origen_tipo: origenTipo(),
        origen_id: origenId(),
    }),
)

/** Campos de texto de `POST /clientes/:id/identidad` (multipart; las fotos van en `frente` y `reverso`). */
export const registrarIdentidadValidator = vine.compile(
    vine.object({
        documento_tipo: vine.enum(['dpi', 'pasaporte'] as const),
        documento_numero: vine.string().trim().minLength(5).maxLength(25).meta({
            description: 'DPI: 13 dígitos con departamento y municipio. Pasaporte: 5 a 20 letras o dígitos',
        }),
        nombre: vine
            .string()
            .trim()
            .minLength(2)
            .maxLength(200)
            .meta({ description: 'Como aparece en el documento' }),
        mayor_de_edad: vine.boolean().meta({ description: 'Debe ser true (sin fecha de nacimiento)' }),
        coincide: vine
            .boolean()
            .meta({ description: 'true: el técnico comprobó que la foto es de quien está presente' }),
        verificado_en: instanteIso(),
        metodo: vine.enum(['foto_documento', 'revision_panel'] as const).meta({
            description:
                'foto_documento (el técnico en sitio) o revision_panel (un supervisor revisa la foto tomada en sitio)',
        }),
        origen_tipo: origenTipo().optional(),
        origen_id: origenId().optional(),
    }),
)
