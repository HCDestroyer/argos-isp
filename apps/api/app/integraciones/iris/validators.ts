import vine from '@vinejs/vine'
import { TIPOS_DESTINO_IRIS } from '#integraciones/iris/actions/abrir_en_iris'

/**
 * Validadores del conector Iris (`contratos/iris.md` §1). El canje del enlace usa el mismo
 * validador que Horus (`canjearEnlaceValidator` de `#integraciones/horus/validators`); el resolver
 * y la emisión de tickets, los del núcleo (`resolverIpsValidator`, `emitirTicketSsoValidator`).
 */

const textoNulable = (max: number) => vine.string().trim().maxLength(max).nullable().optional()

/** `PUT /integraciones/iris`. */
export const configurarIrisValidator = vine.compile(
    vine.object({
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída; 0 si el conector nunca se guardó. 409 si cambió' }),
        activo: vine.boolean().optional(),
        url_base: textoNulable(500).meta({ description: 'Origen de la API de Iris (https://host[:puerto])' }),
        token: textoNulable(500).meta({
            description:
                'Token iris_pat_ de Iris para Argos. Omitido: se conserva; null: se borra. Nunca se devuelve',
        }),
        webhook_salida_url: textoNulable(500).meta({
            description: 'Receptor de Iris para los webhooks de Argos',
        }),
        webhook_salida_secreto: textoNulable(500).meta({
            description: 'Secreto de ese receptor. Omitido: se conserva; null: se borra. Nunca se devuelve',
        }),
    }),
)

/** `POST /integraciones/iris/abrir`. */
export const abrirEnIrisValidator = vine.compile(
    vine.object({
        destino: vine.object({
            tipo: vine.enum(TIPOS_DESTINO_IRIS),
            id_externo: vine.string().trim().minLength(1).maxLength(100).meta({ description: 'Id en Iris' }),
        }),
    }),
)
