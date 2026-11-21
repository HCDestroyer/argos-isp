import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { idEntidad } from '#shared/validadores'
import {
    NOTA_GESTION_MAXIMO,
    ORIGENES_GESTION,
    RESULTADOS_GESTION,
    TIPOS_GESTION,
} from '#billing/gestiones_cobro'

/*
|--------------------------------------------------------------------------
| Decisiones del PM del 21 nov (operación de cobro, A3)
|--------------------------------------------------------------------------
*/

/** `POST /clientes/:id/gestiones-cobro` (contrato Iris 0.13.0). */
export const registrarGestionCobroValidator = vine.compile(
    vine.object({
        tipo: vine.enum(TIPOS_GESTION).meta({ description: 'carta solo desde el panel de Argos' }),
        resultado: vine.enum(RESULTADOS_GESTION),
        ocurrido_en: vine.date({ formats: ['iso8601'] }).meta({
            type: 'string',
            format: 'date-time',
            description:
                'Cuándo ocurrió: entre ahora − 7 días y ahora + 5 minutos (si no, 422 fuera_de_ventana)',
        }),
        origen_tipo: vine.enum(ORIGENES_GESTION).optional().meta({
            description: 'panel solo desde Argos (por defecto); Iris: conversacion, orden o llamada',
        }),
        origen_id: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(128)
            .nullable()
            .optional()
            .meta({ description: 'Id de la conversación, orden o llamada en Iris (obligatorio desde Iris)' }),
        servicio_id: idEntidad().nullable().optional(),
        nota: vine
            .string()
            .trim()
            .maxLength(NOTA_GESTION_MAXIMO)
            .nullable()
            .optional()
            .meta({ description: 'Nota corta, solo desde el panel (Iris no manda texto libre)' }),
    }),
)

export const listarGestionesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        servicio_id: idEntidad().optional(),
        tipo: vine.enum(TIPOS_GESTION).optional(),
    }),
)
