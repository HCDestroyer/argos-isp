import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { coordenadas, idEntidad, instanteIso, versionEsperada } from '#shared/validadores'

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

export const completarDatosValidator = vine.compile(
    vine.object({
        cliente: vine
            .object({
                nombre: vine.string().trim().minLength(2).maxLength(200).optional().meta({
                    description: 'Solo con identidad_id: el nombre como aparece en el documento',
                }),
                telefono: vine.string().trim().maxLength(30).optional(),
                whatsapp: vine.boolean().optional(),
                email: vine.string().trim().email().optional(),
                tipo_documento_fiscal: vine.enum(['cf', 'nit', 'cui'] as const).optional(),
                nit_cui: vine.string().trim().maxLength(20).nullable().optional(),
                relacion: vine.enum(['titular', 'familiar', 'otro'] as const).optional(),
            })
            .optional(),
        servicio: vine
            .object({
                direccion: vine.string().trim().minLength(1).maxLength(300).optional(),
                referencia: vine.string().trim().maxLength(300).optional(),
                coordenadas: coordenadas().optional(),
                precision_m: vine.number().min(0).max(100000).optional(),
            })
            .optional(),
        identidad_id: idEntidad().optional(),
        version: versionOpcional(),
        origen_tipo: origenTipo(),
        origen_id: origenId(),
    }),
)

/** Partes de texto de `POST /servicios/:id/cambiar-titular` (multipart): `datos` es el JSON del cambio. */
export const cambiarTitularPartesValidator = vine.compile(
    vine.object({
        datos: vine.string().minLength(2).maxLength(10_000).meta({
            description:
                'JSON: { cliente: { nombre, documento_tipo, documento_numero, mayor_de_edad, telefono, whatsapp, email?, tipo_documento_fiscal?, nit_cui?, relacion? }, identidad: { coincide, verificado_en, metodo }, motivo_codigo, motivo, version?, origen_tipo, origen_id }',
        }),
    }),
)

/** El JSON de la parte `datos` (§3.4.4). */
export const cambiarTitularDatosValidator = vine.compile(
    vine.object({
        cliente: vine.object({
            nombre: vine.string().trim().minLength(2).maxLength(200),
            documento_tipo: vine.enum(['dpi', 'pasaporte'] as const),
            documento_numero: vine.string().trim().minLength(5).maxLength(25),
            mayor_de_edad: vine.boolean(),
            telefono: vine.string().trim().minLength(8).maxLength(30),
            whatsapp: vine.boolean().optional(),
            email: vine.string().trim().email().nullable().optional(),
            tipo_documento_fiscal: vine.enum(['cf', 'nit', 'cui'] as const).optional(),
            nit_cui: vine.string().trim().maxLength(20).nullable().optional(),
            relacion: vine
                .enum(['titular', 'familiar', 'otro'] as const)
                .nullable()
                .optional(),
        }),
        identidad: vine.object({
            coincide: vine.boolean(),
            verificado_en: instanteIso(),
            metodo: vine.enum(['foto_documento', 'revision_panel'] as const),
        }),
        motivo_codigo: vine.enum(['menor_de_edad', 'otro'] as const),
        motivo: vine.string().trim().minLength(10).maxLength(500),
        version: versionOpcional(),
        origen_tipo: origenTipo(),
        origen_id: origenId(),
    }),
)

export const listarCambiosTitularValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        existente: vine
            .boolean()
            .optional()
            .meta({ description: 'true: los asignados a un cliente que ya existía' }),
        posible_duplicado: vine.boolean().optional(),
    }),
)
