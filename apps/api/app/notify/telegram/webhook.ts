import { Api } from 'grammy'
import { COMANDOS_BOT } from '#notify/telegram/bot'
import { SECRETO_VALIDO, configBotDe, configBotGlobal, type ConfigBot } from '#notify/telegram/config'
import { configPara } from '#notify/configuracion'

/**
 * Registro del webhook en Telegram (`node ace telegram:webhook`). Cada bot tiene **su** URL:
 * `<TELEGRAM_WEBHOOK_URL>/<id del bot>` (`/api/v1/telegram/webhook/123456`), y Telegram la llama
 * con el header `X-Telegram-Bot-Api-Secret-Token` = el secreto del webhook de ese bot. Así, con
 * varias empresas con bots distintos, el webhook sabe de qué bot viene la actualización y con
 * qué token responder. La ruta sin id (`/api/v1/telegram/webhook`) queda para el bot global
 * registrado antes de este cambio.
 */

export const RUTA_WEBHOOK = '/api/v1/telegram/webhook'

export interface OpcionesBotApi {
    config?: ConfigBot
    /** empresa cuyo bot se registra (sin ella, el global) */
    empresaId?: number | null
    /** `fetch` simulado en pruebas */
    fetch?: typeof fetch
}

async function api(opciones: OpcionesBotApi): Promise<{ api: Api; config: ConfigBot }> {
    const config =
        opciones.config ??
        (opciones.empresaId ? configBotDe(await configPara(opciones.empresaId)) : await configBotGlobal())
    if (!config.token) {
        throw new Error('Falta el token del bot (configuración de notificaciones o TELEGRAM_BOT_TOKEN)')
    }
    return {
        config,
        api: new Api(config.token, { apiRoot: config.apiRoot, fetch: opciones.fetch, timeoutSeconds: 20 }),
    }
}

/** `https://x/api/v1/telegram/webhook` + bot `123` → `https://x/api/v1/telegram/webhook/123`. */
export function urlDelBot(base: string, botId: string | null): string {
    const limpia = base.replace(/\/+$/, '')
    if (!botId || limpia.endsWith(`/${botId}`)) return limpia
    return `${limpia}/${botId}`
}

export interface ResultadoRegistro {
    url: string
    comandos: number
}

/** `setWebhook` (solo `message`, con el secreto) y `setMyCommands` con la ayuda en español. */
export async function registrarWebhook(
    opciones: OpcionesBotApi & { url?: string } = {},
): Promise<ResultadoRegistro> {
    const { api: bot, config } = await api(opciones)
    const base = opciones.url ?? config.webhookUrl
    if (!base) throw new Error('Falta TELEGRAM_WEBHOOK_URL (o --url)')
    if (!base.startsWith('https://')) throw new Error('Telegram solo entrega webhooks por HTTPS')
    if (!config.secreto || !SECRETO_VALIDO.test(config.secreto)) {
        throw new Error(
            'El secreto del webhook (configuración de notificaciones o TELEGRAM_WEBHOOK_SECRET) ' +
                'debe tener 16 a 256 caracteres A-Z, a-z, 0-9, _ o -',
        )
    }
    const url = urlDelBot(base, config.botId)
    await bot.setWebhook(url, {
        secret_token: config.secreto,
        allowed_updates: ['message'],
        max_connections: 10,
    })
    await bot.setMyCommands([...COMANDOS_BOT], { language_code: 'es' })
    await bot.setMyCommands([...COMANDOS_BOT])
    return { url, comandos: COMANDOS_BOT.length }
}

export async function infoWebhook(opciones: OpcionesBotApi = {}) {
    const { api: bot } = await api(opciones)
    return bot.getWebhookInfo()
}

export async function borrarWebhook(opciones: OpcionesBotApi = {}) {
    const { api: bot } = await api(opciones)
    return bot.deleteWebhook()
}
