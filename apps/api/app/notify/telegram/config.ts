import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { configPara, configParaSync, type ConfigCanales } from '#notify/configuracion'

/**
 * Configuración del bot de Telegram (`contratos/telegram.md`).
 *
 * Token, nombre del bot y secreto del webhook salen de la configuración de canales del panel
 * (`notify/configuracion.ts`); sin configuración guardada, del entorno:
 *
 * - `TELEGRAM_BOT_TOKEN`: token de @BotFather (también lo usa el canal de notify).
 * - `TELEGRAM_BOT_NOMBRE`: usuario del bot sin `@` (arma `https://t.me/<nombre>?start=<código>`).
 * - `TELEGRAM_WEBHOOK_SECRET`: lo manda Telegram en `X-Telegram-Bot-Api-Secret-Token`. Sin él, el
 *   webhook rechaza todo (nunca acepta actualizaciones sin autenticar).
 *
 * Siempre del entorno (instalación, no panel):
 *
 * - `TELEGRAM_WEBHOOK_URL`: URL pública base del webhook (`https://<api>/api/v1/telegram/webhook`);
 *   `node ace telegram:webhook` registra `<base>/<id del bot>`.
 * - `TELEGRAM_CODIGO_VIGENCIA_S`: vigencia del código de vinculación (900 s).
 */
export interface ConfigBot {
    token: string | null
    /** id público del bot (parte numérica del token) */
    botId: string | null
    nombre: string | null
    secreto: string | null
    webhookUrl: string | null
    apiRoot: string | undefined
    vigenciaS: number
    portalUrl: string | null
}

/** Bot de una configuración de canales (global o de una empresa). */
export function configBotDe(config: ConfigCanales, entorno: NodeJS.ProcessEnv = process.env): ConfigBot {
    const vigencia = Number(entorno.TELEGRAM_CODIGO_VIGENCIA_S)
    return {
        token: config.telegram.token,
        botId: config.telegram.botId,
        nombre: (config.telegram.botNombre || '').replace(/^@/, '') || null,
        secreto: config.telegram.webhookSecreto,
        webhookUrl: entorno.TELEGRAM_WEBHOOK_URL || null,
        apiRoot: entorno.TELEGRAM_API_ROOT || undefined,
        vigenciaS: Number.isInteger(vigencia) && vigencia >= 60 ? vigencia : 900,
        portalUrl: entorno.NOTIFY_PORTAL_URL || null,
    }
}

/** Bot de la configuración global, con la última configuración cargada (síncrono). */
export function configBot(entorno: NodeJS.ProcessEnv = process.env): ConfigBot {
    return configBotDe(configParaSync(null), entorno)
}

/** Bot de la configuración global, leída de la base si hace falta. */
export async function configBotGlobal(): Promise<ConfigBot> {
    return configBotDe(await configPara(null))
}

/** Telegram solo acepta `A-Z a-z 0-9 _ -` (1 a 256) como `secret_token`. */
export const SECRETO_VALIDO = /^[A-Za-z0-9_-]{16,256}$/

/** Compara el header del webhook con el secreto en tiempo constante. Sin secreto: siempre falso. */
export function secretoCoincide(recibido: string | undefined | null, secreto: string | null): boolean {
    if (!secreto || !recibido) return false
    const a = createHash('sha256').update(recibido).digest()
    const b = createHash('sha256').update(secreto).digest()
    return timingSafeEqual(a, b) && recibido.length === secreto.length
}

/**
 * Alfabeto del código de vinculación: mayúsculas y dígitos sin los ambiguos (0/O, 1/I/L), para
 * que también se pueda escribir a mano (`/start K7QX2M9PTA`). 31 símbolos × 10 ≈ 49 bits.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LARGO_CODIGO = 10

export function generarCodigoVinculacion(): string {
    let codigo = ''
    for (let i = 0; i < LARGO_CODIGO; i++) codigo += ALFABETO[randomInt(0, ALFABETO.length)]
    return codigo
}

/** Quita espacios y guiones y pasa a mayúsculas; `null` si no tiene la forma de un código. */
export function normalizarCodigo(entrada: string): string | null {
    const limpio = entrada.replace(/[\s-]/g, '').toUpperCase()
    if (limpio.length !== LARGO_CODIGO) return null
    for (const letra of limpio) if (!ALFABETO.includes(letra)) return null
    return limpio
}

export function hashCodigoVinculacion(codigo: string): string {
    return createHash('sha256').update(`telegram:${codigo}`).digest('hex')
}

export function enlaceInicio(nombreBot: string, codigo: string): string {
    return `https://t.me/${nombreBot}?start=${codigo}`
}
