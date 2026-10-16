import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import { configBot } from '#notify/telegram/config'

/**
 * Lado del portal de la vinculación de Telegram (`.claude/integration/contratos/telegram.md`, de A6).
 * El código, su tabla y el canje son de A6 (`GenerarCodigoTelegram`, `CanjearCodigoTelegram`); aquí
 * solo se lee el estado para la pantalla "Mis datos".
 */

/** Espejo del schema `PortalTelegram`. */
export interface EstadoTelegramPortal {
    /** el cliente tiene `telegram_chat_id` */
    vinculado: boolean
    /** el bot está configurado (`TELEGRAM_BOT_TOKEN` y `TELEGRAM_BOT_NOMBRE`): se puede pedir un código */
    disponible: boolean
    /** usuario del bot sin `@` */
    bot: string | null
}

export async function estadoTelegram(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstadoTelegramPortal> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select('telegram_chat_id')
        .first()) as { telegram_chat_id: string | null } | null
    const config = configBot()
    const disponible = Boolean(config.token && config.nombre)
    return {
        vinculado: Boolean(fila?.telegram_chat_id),
        disponible,
        bot: disponible ? config.nombre : null,
    }
}
