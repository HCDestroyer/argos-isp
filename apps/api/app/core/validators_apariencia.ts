import vine from '@vinejs/vine'
// corrección de `.meta()` de VineJS 4.4.0
import '#shared/vine_meta'
import { IDS_TEMAS, MODOS } from '#core/apariencia'
import { LARGO_MAXIMO_SECCION, MAXIMO_ACCESOS, PATRON_SECCION } from '#core/accesos_rapidos'

/** Validadores de apariencia (`contratos/apariencia.md`) y accesos rápidos (`contratos/accesos-rapidos.md`). */

const version = vine
    .number()
    .withoutDecimals()
    .min(1)
    .meta({ description: 'version leída de la apariencia; si cambió responde 409' })

export const editarAparienciaValidator = vine.compile(
    vine.object({
        version,
        tema: vine.enum(IDS_TEMAS).optional().meta({ description: 'Preset de tema (`temas`)' }),
        modo_predeterminado: vine
            .enum(MODOS)
            .optional()
            .meta({ description: 'Modo inicial de la interfaz: sistema, claro u oscuro' }),
        nombre_marca: vine.string().trim().minLength(1).maxLength(60).optional(),
        eslogan: vine.string().trim().maxLength(120).nullable().optional().meta({
            description: 'Texto bajo la marca en el inicio de sesión; null o vacío = sin eslogan',
        }),
    }),
)

/** Campos de texto del multipart de logo y fondo (el archivo va en `archivo`). */
export const versionAparienciaValidator = vine.compile(vine.object({ version }))

export const editarAccesosRapidosValidator = vine.compile(
    vine.object({
        secciones: vine
            .array(vine.string().trim().maxLength(LARGO_MAXIMO_SECCION).regex(PATRON_SECCION))
            .maxLength(MAXIMO_ACCESOS)
            .distinct()
            .nullable()
            .meta({
                description:
                    'Ids de sección del panel en orden (hasta 12, sin repetidos); null = volver a los predeterminados por rol',
            }),
        version: vine
            .number()
            .withoutDecimals()
            .min(1)
            .optional()
            .meta({ description: 'version leída; si cambió responde 409. Omitida = último gana' }),
    }),
)
