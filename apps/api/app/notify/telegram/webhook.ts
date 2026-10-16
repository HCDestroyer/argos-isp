import { Api } from 'grammy'
import { COMANDOS_BOT } from '#notify/telegram/bot'
import { SECRETO_VALIDO, configBot, type ConfigBot } from '#notify/telegram/config'

/**
 * Registro del webhook en Telegram (`node ace telegram:webhook`). Telegram mandará cada
 * actualización a `TELEGRAM_WEBHOOK_URL` (`.../api/v1/telegram/webhook`) con el header
 * `X-Telegram-Bot-Api-Secret-Token: TELEGRAM_WEBHOOK_SECRET`.
 */

export const RUTA_WEBHOOK = '/api/v1/telegram/webhook'

export interface OpcionesBotApi {
    config?: ConfigBot
    /** `fetch` simulado en pruebas */
    fetch?: typeof fetch
}

function api(opciones: OpcionesBotApi): { api: Api; config: ConfigBot } {
    const config = opciones.config ?? configBot()
    if (!config.token) throw new Error('Falta TELEGRAM_BOT_TOKEN')
    return {
        config,
        api: new Api(config.token, { apiRoot: config.apiRoot, fetch: opciones.fetch, timeoutSeconds: 20 }),
    }
}

export interface ResultadoRegistro {
    url: string
    comandos: number
}

/** `setWebhook` (solo `message`, con el secreto) y `setMyCommands` con la ayuda en español. */
export async function registrarWebhook(
    opciones: OpcionesBotApi & { url?: string } = {},
): Promise<ResultadoRegistro> {
    const { api: bot, config } = api(opciones)
    const url = opciones.url ?? config.webhookUrl
    if (!url) throw new Error('Falta TELEGRAM_WEBHOOK_URL (o --url)')
    if (!url.startsWith('https://')) throw new Error('Telegram solo entrega webhooks por HTTPS')
    if (!config.secreto || !SECRETO_VALIDO.test(config.secreto)) {
        throw new Error('TELEGRAM_WEBHOOK_SECRET debe tener 16 a 256 caracteres A-Z, a-z, 0-9, _ o -')
    }
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
    return api(opciones).api.getWebhookInfo()
}

export async function borrarWebhook(opciones: OpcionesBotApi = {}) {
    return api(opciones).api.deleteWebhook()
}
