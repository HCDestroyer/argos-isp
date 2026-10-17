import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { configPara, type ConfigCanales } from '#notify/configuracion'

/**
 * Telegram por empresa (`contratos/telegram.md`, "Varios bots"). Cada empresa usa el bot de su
 * configuración de canales (el suyo o, si hereda, el global). Un bot solo puede escribir a quien
 * lo inició, así que la vinculación es **por bot**: `notify.telegram_vinculos` (cliente, bot,
 * chat). Un cliente con servicios en dos empresas con bots distintos se vincula a los dos.
 *
 * - `core.clientes.telegram_chat_id` (A1) es el interruptor general: sin él no se envía por
 *   ningún bot (desvincular desde el panel o el portal corta todo).
 * - **Vinculación anterior** (antes de los bots por empresa, o desde el panel con
 *   `POST /clientes/:id/vincular-telegram`): un cliente con `telegram_chat_id` y **sin** filas en
 *   `telegram_vinculos` vale para el bot global.
 * - Sin token configurado (`botId` null) no hay bot que elegir: se devuelve el chat del cliente y
 *   la disponibilidad del canal decide.
 */

export interface VinculoTelegram {
    bot_id: string
    chat_id: string
    empresa_id: number | null
}

export async function vinculosDelCliente(
    cliente: QueryClientContract,
    clienteId: number,
): Promise<VinculoTelegram[]> {
    const filas = (await cliente
        .from('notify.telegram_vinculos')
        .where('cliente_id', clienteId)
        .orderBy('id')
        .select('bot_id', 'chat_id', 'empresa_id')) as VinculoTelegram[]
    return filas.map((f) => ({ ...f, empresa_id: f.empresa_id === null ? null : Number(f.empresa_id) }))
}

/** Id del bot global (configuración global o entorno), o null sin token. */
export async function botGlobalId(): Promise<string | null> {
    const global = await configPara(null)
    return global.telegram.token ? global.telegram.botId : null
}

/**
 * Chat al que el bot de `config` puede escribirle al cliente, o null si ese bot no lo tiene
 * vinculado (el aviso sale por los otros canales).
 */
export async function chatTelegramPara(
    cliente: QueryClientContract,
    clienteId: number,
    config: ConfigCanales,
): Promise<string | null> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select('telegram_chat_id')
        .first()) as {
        telegram_chat_id: string | null
    } | null
    const general = fila?.telegram_chat_id || null
    if (!general) return null
    const botId = config.telegram.token ? config.telegram.botId : null
    if (!botId) return general
    const vinculos = await vinculosDelCliente(cliente, clienteId)
    const propio = vinculos.find((v) => v.bot_id === botId)
    if (propio) return propio.chat_id
    if (vinculos.length > 0) return null
    const global = await botGlobalId()
    return global === null || global === botId ? general : null
}

/**
 * Clientes que este chat tiene vinculados **en este bot** (para `/estado` y `/desvincular`): los
 * vinculados por `telegram_vinculos` y, en el bot global, los de la vinculación anterior.
 */
export async function clientesDelChat(
    chatId: string,
    botId: string | null,
    cliente: QueryClientContract = db.connection(),
): Promise<number[]> {
    const global = await botGlobalId()
    const esGlobal = botId === null || global === null || botId === global
    const consulta = cliente
        .from('core.clientes as c')
        .whereNotNull('c.telegram_chat_id')
        .where((q) => {
            if (botId !== null) {
                q.whereExists((sub) =>
                    sub
                        .from('notify.telegram_vinculos as v')
                        .whereRaw('v.cliente_id = c.id')
                        .where('v.bot_id', botId)
                        .where('v.chat_id', chatId),
                )
            }
            if (esGlobal) {
                q.orWhere((legado) =>
                    legado
                        .where('c.telegram_chat_id', chatId)
                        .whereNotExists((sub) =>
                            sub.from('notify.telegram_vinculos as v').whereRaw('v.cliente_id = c.id'),
                        ),
                )
            }
        })
        .orderBy('c.id')
        .select('c.id')
    const filas = (await consulta) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

/**
 * Empresas activas cuyos avisos salen por este bot (su configuración propia o, si heredan, la
 * global). `null` = todas (sin bot identificado).
 */
export async function empresasDelBot(
    botId: string | null,
    cliente: QueryClientContract = db.connection(),
): Promise<number[] | null> {
    if (botId === null) return null
    const filas = (await cliente
        .from('core.empresas')
        .where('activa', true)
        .orderBy('id')
        .select('id')) as Array<{
        id: number
    }>
    const ids: number[] = []
    for (const fila of filas) {
        const config = await configPara(Number(fila.id))
        if (config.telegram.botId === botId) ids.push(Number(fila.id))
    }
    return ids
}

/**
 * Empresa de la que se pide un código de vinculación cuando no la dice quien llama: la única
 * empresa de los servicios vigentes del cliente; con varias (o ninguna), null (el bot global).
 */
export async function empresaUnicaDelCliente(
    cliente: QueryClientContract,
    clienteId: number,
): Promise<number | null> {
    const filas = (await cliente
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')) as Array<{ empresa_id: number }>
    return filas.length === 1 ? Number(filas[0]!.empresa_id) : null
}

/** Estado de Telegram del cliente por empresa (portal, panel). */
export interface TelegramEmpresa {
    empresa_id: number
    /** usuario del bot sin `@`; null si la empresa no tiene bot */
    bot: string | null
    bot_id: string | null
    vinculado: boolean
}

export async function telegramPorEmpresa(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<TelegramEmpresa[]> {
    const filas = (await cliente
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')
        .orderBy('empresa_id')) as Array<{ empresa_id: number }>
    const salida: TelegramEmpresa[] = []
    for (const fila of filas) {
        const empresaId = Number(fila.empresa_id)
        const config = await configPara(empresaId)
        const nombre = (config.telegram.botNombre || '').replace(/^@/, '') || null
        salida.push({
            empresa_id: empresaId,
            bot: config.telegram.token ? nombre : null,
            bot_id: config.telegram.token ? config.telegram.botId : null,
            vinculado:
                (await chatTelegramPara(cliente, clienteId, config)) !== null && !!config.telegram.token,
        })
    }
    return salida
}
