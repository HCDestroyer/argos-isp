import vine from '@vinejs/vine'
import { TIPOS_DESTINO_IRIS } from '#integraciones/iris/actions/abrir_en_iris'

/**
 * Validadores del conector Iris (`contratos/iris.md` §1). El canje del enlace es el de Horus más el
 * `code_verifier` de §1.4; el resolver y la emisión de tickets, los del núcleo
 * (`resolverIpsValidator`, `emitirTicketSsoValidator`).
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

/** Caracteres seguros en URL (RFC 3986 «unreserved»): `state` y `code_verifier`. */
const URL_SEGURO = /^[A-Za-z0-9._~-]+$/

/** `POST /integraciones/iris/conexion/canjear` (el de Horus §1.4 más PKCE, contrato Iris §1.4). */
export const canjearEnlaceIrisValidator = vine.compile(
    vine.object({
        codigo: vine.string().trim().minLength(16).maxLength(200),
        sistema: vine.string().trim().maxLength(50),
        base_url: vine.string().trim().maxLength(500),
        token: vine.string().trim().maxLength(500),
        webhook: vine.object({
            url: vine.string().trim().maxLength(500),
            secreto: vine.string().trim().maxLength(500),
        }),
        code_verifier: vine
            .string()
            .minLength(43)
            .maxLength(128)
            .regex(URL_SEGURO)
            .optional()
            .meta({
                description:
                    'PKCE (RFC 7636): obligatorio si el código nació en «Conectar con un botón» (§1.4). ' +
                    'Falta o no coincide con el code_challenge → 401 `codigo_invalido` y el código queda gastado',
            }),
    }),
)

const origenIris = () =>
    vine
        .string()
        .trim()
        .minLength(1)
        .maxLength(500)
        .meta({ description: 'Dirección de Iris (`https://host[:puerto]`); se normaliza a su origen' })

/** `POST /integraciones/iris/autorizar` (contrato Iris §1.4 paso 4). */
export const autorizarIrisValidator = vine.compile(
    vine.object({
        iris: origenIris(),
        state: vine.string().minLength(16).maxLength(256).regex(URL_SEGURO).meta({
            description:
                'Valor opaco de Iris (16 a 256 caracteres A-Z a-z 0-9 . _ ~ -); vuelve en el fragmento',
        }),
        code_challenge: vine.string().trim().maxLength(200).meta({
            description:
                'base64url(SHA-256(code_verifier)), 43 caracteres. Si no → 422 `code_challenge_invalido`',
        }),
        code_challenge_method: vine.enum(['S256'] as const),
        confirmar_origen: vine
            .string()
            .trim()
            .maxLength(300)
            .nullable()
            .optional()
            .meta({
                description:
                    'Dominio de Iris escrito por el admin (su host, con puerto si lo lleva). Obligatorio si el ' +
                    'origen no es el del conector ni está en `ARGOSISP_IRIS_ORIGENES` (422 `iris_origen_no_confirmado`)',
            }),
    }),
)

/** `GET /integraciones/iris/autorizar/vista-previa?iris=`. */
export const vistaPreviaAutorizarIrisValidator = vine.compile(vine.object({ iris: origenIris() }))
