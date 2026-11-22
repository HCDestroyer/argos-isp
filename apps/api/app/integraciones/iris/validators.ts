import vine from '@vinejs/vine'
import { TIPOS_DESTINO_IRIS } from '#integraciones/iris/actions/abrir_en_iris'
import { FORMATO_SEMVER } from '#integraciones/iris/configuracion'
import { METODOS_VERIFICACION } from '#core/actions/verificar_identidad_cliente'
import { instanteIso } from '#shared/validadores'

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

/** Versión del contrato que habla Iris (semver, contrato 0.5.0 «Versión y compatibilidad»). */
const contratoIris = () =>
    vine
        .string()
        .trim()
        .maxLength(64)
        .regex(FORMATO_SEMVER)
        .meta({ description: 'Versión del contrato Iris ↔ Argos que habla Iris (semver, p. ej. `0.5.0`)' })

/** `receptor_argos` (contrato 0.6.2): si Iris guardó la URL y el secreto del receptor de Argos. */
const receptorArgos = (descripcion: string) =>
    vine.boolean({ strict: true }).optional().meta({ description: descripcion })

/** `PUT /integraciones/iris/contrato` (con el token de Iris). */
export const contratoIrisValidator = vine.compile(
    vine.object({
        contrato: contratoIris(),
        token_portal: vine
            .string()
            .trim()
            .maxLength(500)
            .nullable()
            .optional()
            .meta({
                description:
                    'Contrato 0.9.0 §1.2: `iris_pat_` recortado a `portal_argos.*` para el servidor del portal del cliente. ' +
                    'Solo con contrato ≥ 0.9.0 (con uno anterior se ignora). Omitido: se conserva el guardado. Argos lo guarda cifrado y nunca lo devuelve; en la auditoría queda como ***',
            }),
        receptor_argos: receptorArgos(
            'Contrato Iris 0.6.2: true si Iris tiene guardados la URL y el secreto del receptor de webhooks de ' +
                'Argos (los del canje); false si no (conector canjeado antes de B1: el panel pide volver a ' +
                'conectar). Omitido: se conserva el último informado',
        ),
        vinculos_cargados: vine.number().withoutDecimals().min(0).max(1000000).nullable().optional().meta({
            description:
                'Contrato 0.14.0 §6.6 (N-1): Iris cierra la carga inicial de vínculos de técnicos (tecnico.argos_vinculado) con el número que envió. Hasta entonces, las peticiones con tecnico responden 409 vinculos_en_carga. Solo con contrato ≥ 0.14.0',
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
        contrato: contratoIris()
            .optional()
            .meta({
                description:
                    'Versión del contrato que habla Iris (semver, 0.5.0). Se guarda en el conector: sin ella, ' +
                    'Argos no envía los webhooks nuevos de 0.5.0',
            }),
        token_portal: vine
            .string()
            .trim()
            .maxLength(500)
            .nullable()
            .optional()
            .meta({
                description:
                    'Contrato 0.9.0 §1.2: `iris_pat_` recortado a `portal_argos.*` para el servidor del portal del cliente. ' +
                    'Se rota con cada canje (ausente: el conector queda sin él). Argos lo guarda cifrado y nunca lo devuelve; en la auditoría queda como ***',
            }),
        receptor_argos: receptorArgos(
            'Contrato Iris 0.6.2: true si Iris guardó la URL y el secreto del receptor de Argos de esta respuesta ' +
                '(con B1, siempre true). Se guarda en el conector; omitido queda null (desconocido)',
        ),
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

/** `POST /integraciones/iris/verificar-identidad` (contrato Iris 0.6.0 §7.5). */
export const verificarIdentidadValidator = vine.compile(
    vine.object({
        cliente_id: vine
            .number()
            .withoutDecimals()
            .positive()
            .meta({ description: 'El cliente que dice ser' }),
        metodo: vine.enum(METODOS_VERIFICACION).meta({
            description:
                '`documento` (NIT o CUI completo), `nombre` o `codigo_cliente`. `nombre` y `codigo_cliente` son ' +
                'pruebas débiles: solo valen junto con otra',
        }),
        valor: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(200)
            .meta({ description: 'Lo que dijo el cliente. Argos nunca lo devuelve y lo audita como `***`' }),
    }),
)

/** Recursos de la primera sincronización de Iris (contrato 0.8.0, §2.5). */
export const RECURSOS_SINCRONIZACION_IRIS = [
    'empresas',
    'zonas',
    'planes',
    'routers',
    'cuentas_bancarias',
    'bancos',
    'clientes',
    'servicios',
] as const
export const ESTADOS_SINCRONIZACION_IRIS = ['en_curso', 'completa', 'con_errores'] as const
export const ESTADOS_ETAPA_SINCRONIZACION_IRIS = ['pendiente', 'en_curso', 'completa', 'con_errores'] as const

/** UUID v7 (RFC 9562): versión 7 y variante 10xx. */
export const FORMATO_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** `PUT /integraciones/iris/sincronizacion` (con el token de Iris, contrato 0.8.0). */
export const sincronizacionIrisValidator = vine.compile(
    vine.object({
        sincronizacion_id: vine
            .string()
            .trim()
            .regex(FORMATO_UUID_V7)
            .meta({ description: 'UUID v7 de la sincronización, generado por Iris' }),
        estado: vine.enum(ESTADOS_SINCRONIZACION_IRIS),
        iniciada_en: instanteIso(),
        // cuándo cambió por última vez en Iris; menor que el guardado para la misma sincronización: 409
        actualizada_en: instanteIso(),
        etapas: vine
            .array(
                vine.object({
                    recurso: vine.enum(RECURSOS_SINCRONIZACION_IRIS),
                    estado: vine.enum(ESTADOS_ETAPA_SINCRONIZACION_IRIS),
                    procesados: vine.number().withoutDecimals().min(0),
                    total: vine.number().withoutDecimals().min(0).nullable(),
                    error: vine
                        .string()
                        .trim()
                        .maxLength(300)
                        .nullable()
                        .meta({ description: 'Hasta 300 caracteres, sin datos de clientes' }),
                    terminada_en: instanteIso().nullable(),
                }),
            )
            .maxLength(RECURSOS_SINCRONIZACION_IRIS.length)
            .distinct('recurso'),
    }),
)
