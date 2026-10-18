import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { idEntidad, versionEsperada } from '#shared/validadores'

/*
|--------------------------------------------------------------------------
| Validadores del módulo notify (A6)
|--------------------------------------------------------------------------
*/

export const editarPlantillaNotificacionValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        asunto: vine
            .string()
            .trim()
            .maxLength(300)
            .nullable()
            .optional()
            .meta({ description: 'Asunto Mustache (solo correo; en Telegram va como primera línea)' }),
        cuerpo: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(4000)
            .optional()
            .meta({ description: 'Cuerpo Mustache en texto plano' }),
        activa: vine.boolean().optional(),
    }),
)

export const listarEnviosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        evento: vine.string().trim().maxLength(100).optional(),
        canal: vine.enum(['correo', 'telegram', 'whatsapp'] as const).optional(),
        estado: vine.enum(['encolado', 'enviado', 'fallido', 'omitido'] as const).optional(),
    }),
)

export const editarRecordatorioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        dias: vine.number().withoutDecimals().range([-60, 60]).optional().meta({
            description: 'Días respecto al vencimiento: negativo antes, 0 el día, positivo después',
        }),
        hora: vine
            .string()
            .trim()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional()
            .meta({ description: 'HH:MM, hora de Guatemala' }),
        activo: vine.boolean().optional(),
    }),
)

/**
 * Actualización de Telegram que entra por el webhook del bot. Solo lo que usa el bot (`message`
 * con `chat` y `text`); VineJS descarta el resto de campos. Otros tipos de actualización
 * (editados, callbacks) llegan sin `message` y se ignoran.
 */
export const telegramActualizacionValidator = vine.compile(
    vine.object({
        update_id: vine.number().withoutDecimals(),
        message: vine
            .object({
                message_id: vine.number().withoutDecimals(),
                chat: vine.object({
                    id: vine.number().withoutDecimals(),
                    type: vine.string().maxLength(20),
                }),
                text: vine.string().maxLength(4096).optional(),
            })
            .optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Configuración de canales (correo y Telegram) desde el panel
|--------------------------------------------------------------------------
*/

/** Token de @BotFather: `<id numérico>:<35 caracteres>`. */
const TOKEN_BOT = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/
/** Lo que Telegram acepta como `secret_token`. */
const SECRETO_WEBHOOK = /^[A-Za-z0-9_-]{16,256}$/
/** Direcciones de correo separadas por coma (vacío permitido: lo quita). */
const LISTA_CORREOS = /^\s*(?:[^\s@,]+@[^\s@,]+\.[^\s@,]+\s*(?:,\s*|$))*$/

const correoConfig = () =>
    vine
        .object({
            activo: vine.boolean().optional().meta({ description: 'Interruptor del canal correo' }),
            host: vine
                .string()
                .trim()
                .maxLength(255)
                .regex(/^[^\s/]*$/)
                .nullable()
                .optional()
                .meta({ description: 'Servidor SMTP (nombre o IP). Vacío o null lo quita' }),
            puerto: vine.number().withoutDecimals().range([1, 65535]).nullable().optional(),
            tls: vine
                .enum(['auto', 'starttls', 'tls', 'ninguno'] as const)
                .optional()
                .meta({
                    description:
                        '`auto`: STARTTLS si el servidor lo ofrece; `starttls`: lo exige; `tls`: TLS desde el inicio (465); `ninguno`: sin cifrar',
                }),
            usuario: vine.string().trim().maxLength(255).nullable().optional(),
            password: vine.string().maxLength(500).notIn(['***']).nullable().optional().meta({
                description: 'Contraseña SMTP. Omitida: se conserva; null: se borra; texto: se reemplaza',
            }),
            remitente: vine.string().trim().email().maxLength(255).nullable().optional().meta({
                description: 'Dirección del remitente (no-responder@dominio)',
            }),
            nombre_visible: vine.string().trim().maxLength(100).nullable().optional().meta({
                description: 'Nombre visible del remitente',
            }),
            contabilidad: vine
                .string()
                .trim()
                .maxLength(1000)
                .regex(LISTA_CORREOS)
                .nullable()
                .optional()
                .meta({
                    description:
                        'Correo de contabilidad para los avisos fiscales; varias direcciones separadas por coma. Vacío o null lo quita',
                }),
        })
        .optional()

const telegramConfig = () =>
    vine
        .object({
            clientes_activo: vine
                .boolean()
                .optional()
                .meta({ description: 'Interruptor de Telegram a clientes' }),
            alertas_activo: vine
                .boolean()
                .optional()
                .meta({ description: 'Interruptor de las alertas por Telegram al chat del equipo' }),
            token: vine.string().trim().regex(TOKEN_BOT).nullable().optional().meta({
                description:
                    'Token del bot (@BotFather). Omitido: se conserva; null: se borra; texto: se reemplaza',
            }),
            bot_nombre: vine
                .string()
                .trim()
                .regex(/^@?[A-Za-z0-9_]{5,32}$/)
                .nullable()
                .optional()
                .meta({ description: 'Usuario del bot, sin @ (arma los enlaces t.me)' }),
            chat_equipo: vine
                .string()
                .trim()
                .regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/)
                .nullable()
                .optional()
                .meta({ description: 'Chat del equipo para alertas (id numérico o @canal)' }),
            webhook_secreto: vine.string().trim().regex(SECRETO_WEBHOOK).nullable().optional().meta({
                description:
                    'Secreto del webhook (16 a 256 caracteres A-Z a-z 0-9 _ -). Omitido: se conserva o se genera si hay token; null: se borra',
            }),
        })
        .optional()

const avisosConfig = () =>
    vine
        .object({
            factura: vine.boolean().optional(),
            vencimiento: vine.boolean().optional(),
            recordatorio: vine.boolean().optional(),
            corte: vine.boolean().optional(),
            pago: vine.boolean().optional(),
            promesa: vine.boolean().optional(),
            comprobante: vine.boolean().optional(),
        })
        .optional()

const versionConfig = () =>
    vine
        .number()
        .withoutDecimals()
        .min(0)
        .meta({ description: 'version leída; 0 si todavía no hay configuración guardada. 409 si cambió' })

export const configurarNotificacionesGlobalValidator = vine.compile(
    vine.object({
        version: versionConfig(),
        correo: correoConfig(),
        telegram: telegramConfig(),
        avisos: avisosConfig(),
    }),
)

export const configurarNotificacionesEmpresaValidator = vine.compile(
    vine.object({
        version: versionConfig(),
        hereda: vine
            .boolean()
            .optional()
            .meta({ description: 'true: usa la configuración global (por defecto en una empresa nueva)' }),
        correo: correoConfig(),
        telegram: telegramConfig(),
        avisos: avisosConfig(),
    }),
)

export const probarCanalValidator = vine.compile(
    vine.object({
        canal: vine.enum(['correo', 'telegram'] as const),
        destino: vine.string().trim().maxLength(255).nullable().optional().meta({
            description:
                'Correo destino (obligatorio en correo) o chat de Telegram (por defecto, el del equipo)',
        }),
    }),
)
