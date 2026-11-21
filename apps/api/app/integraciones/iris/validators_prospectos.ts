import vine from '@vinejs/vine'
import { coordenadas, idEntidad } from '#shared/validadores'
import { reglasPaginacion } from '#shared/paginacion'

/** Validadores de prospectos registrados desde Argos en Iris (contrato Iris 0.10.0 §3.6, A44). */

export const registrarProspectoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        origen: vine.enum(['oficina', 'llamada', 'whatsapp', 'referido', 'otro']),
        nombre: vine.string().trim().minLength(2).maxLength(200),
        telefonos: vine
            .array(
                vine.object({
                    numero: vine.string().trim().maxLength(20).meta({ description: 'E.164: +50255123344' }),
                    whatsapp: vine.boolean(),
                    principal: vine.boolean(),
                    nombre: vine.string().trim().minLength(1).maxLength(200).nullable().optional(),
                    relacion: vine.enum(['titular', 'familiar', 'otro']).nullable().optional(),
                }),
            )
            .minLength(1)
            .maxLength(5),
        modo: vine.enum(['residencial', 'empresarial']),
        direccion: vine.string().trim().minLength(1).maxLength(300),
        zona_id: idEntidad().nullable().optional(),
        coordenadas: coordenadas().nullable().optional(),
        plan_interes_id: idEntidad().nullable().optional(),
        comentario: vine.string().trim().maxLength(500).nullable().optional(),
        cliente_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'Solo si se eligió un cliente existente de la empresa' }),
    }),
)

export const listarProspectosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        entrega: vine.enum(['pendiente', 'enviado', 'duplicado', 'rechazado', 'fallido']).optional(),
    }),
)
