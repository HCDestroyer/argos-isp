import { createHash, randomBytes } from 'node:crypto'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import { enteroDeEntorno } from '#portal/redis_portal'

/**
 * Códigos de vinculación de Telegram (semana 2). Contrato en
 * `.claude/integration/contratos/telegram.md`.
 *
 * - Código: `vt_` + 24 bytes aleatorios en base64url (35 caracteres, válido para `?start=`).
 * - Solo se guarda `sha256(código)`: el código tiene 192 bits de entropía, no hace falta HMAC.
 */

export const PREFIJO_VINCULO = 'vt_'
export const FORMATO_VINCULO = /^vt_[A-Za-z0-9_-]{32}$/

/** Usuario del bot sin `@` (`PORTAL_TELEGRAM_BOT`); null si no está configurado. */
export function botTelegram(entorno: NodeJS.ProcessEnv = process.env): string | null {
    const bot = entorno.PORTAL_TELEGRAM_BOT?.trim().replace(/^@/, '')
    if (!bot) return null
    if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(bot)) {
        throw new Error(`PORTAL_TELEGRAM_BOT: "${bot}" no es un usuario de bot de Telegram válido`)
    }
    return bot
}

/** Vigencia del código (`PORTAL_TELEGRAM_VIGENCIA_S`, 900 s por defecto, mínimo 60). */
export function vigenciaVinculoS(entorno: NodeJS.ProcessEnv = process.env): number {
    return enteroDeEntorno(entorno, 'PORTAL_TELEGRAM_VIGENCIA_S', 900, 60)
}

export function generarCodigoVinculo(): string {
    return `${PREFIJO_VINCULO}${randomBytes(24).toString('base64url')}`
}

export function hashVinculo(codigo: string): string {
    return createHash('sha256').update(codigo).digest('hex')
}

export function enlaceVinculo(bot: string, codigo: string): string {
    return `https://t.me/${bot}?start=${codigo}`
}

/** Espejo del schema `PortalTelegram`. */
export interface EstadoTelegramPortal {
    /** el cliente tiene `telegram_chat_id` */
    vinculado: boolean
    /** hay bot configurado (`PORTAL_TELEGRAM_BOT`): se puede generar un enlace */
    disponible: boolean
    bot: string | null
    /** vencimiento del último código sin usar ni reemplazar, si sigue vigente */
    pendiente_hasta: string | null
}

export async function estadoTelegram(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstadoTelegramPortal> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select('telegram_chat_id')
        .first()) as {
        telegram_chat_id: string | null
    } | null
    const pendiente = (await cliente
        .from('core.portal_vinculos_telegram')
        .where('cliente_id', clienteId)
        .whereNull('usado_en')
        .whereNull('reemplazado_en')
        .where('expira_en', '>', cliente.raw('now()'))
        .orderBy('expira_en', 'desc')
        .select('expira_en')
        .first()) as { expira_en: Date } | null
    const bot = botTelegram()
    return {
        vinculado: Boolean(fila?.telegram_chat_id),
        disponible: bot !== null,
        bot,
        pendiente_hasta: pendiente ? new Date(pendiente.expira_en).toISOString() : null,
    }
}
