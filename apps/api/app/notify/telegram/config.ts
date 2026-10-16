import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Configuración del bot de Telegram (`contratos/telegram.md`). Se lee del entorno en cada uso,
 * así las pruebas pueden cambiarla sin reiniciar el proceso.
 *
 * - `TELEGRAM_BOT_TOKEN`: token de @BotFather (también lo usa el canal de notify).
 * - `TELEGRAM_BOT_NOMBRE`: usuario del bot sin `@` (arma `https://t.me/<nombre>?start=<código>`).
 * - `TELEGRAM_WEBHOOK_SECRET`: lo manda Telegram en `X-Telegram-Bot-Api-Secret-Token`. Sin él, el
 *   webhook rechaza todo (nunca acepta actualizaciones sin autenticar).
 * - `TELEGRAM_WEBHOOK_URL`: URL pública del webhook para `node ace telegram:webhook`.
 * - `TELEGRAM_CODIGO_VIGENCIA_S`: vigencia del código de vinculación (900 s).
 */
export interface ConfigBot {
    token: string | null
    nombre: string | null
    secreto: string | null
    webhookUrl: string | null
    apiRoot: string | undefined
    vigenciaS: number
    portalUrl: string | null
}

export function configBot(entorno: NodeJS.ProcessEnv = process.env): ConfigBot {
    const vigencia = Number(entorno.TELEGRAM_CODIGO_VIGENCIA_S)
    return {
        token: entorno.TELEGRAM_BOT_TOKEN || null,
        nombre: (entorno.TELEGRAM_BOT_NOMBRE || '').replace(/^@/, '') || null,
        secreto: entorno.TELEGRAM_WEBHOOK_SECRET || null,
        webhookUrl: entorno.TELEGRAM_WEBHOOK_URL || null,
        apiRoot: entorno.TELEGRAM_API_ROOT || undefined,
        vigenciaS: Number.isInteger(vigencia) && vigencia >= 60 ? vigencia : 900,
        portalUrl: entorno.NOTIFY_PORTAL_URL || null,
    }
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
