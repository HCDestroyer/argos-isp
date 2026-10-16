import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'

/** Chat de Telegram: entero con signo (los grupos son negativos), como texto. */
export const CHAT_ID_TELEGRAM = /^-?\d{1,20}$/

export interface EntradaVincularTelegram {
    id: number
    chat_id: string
}

/** Bloquea la fila del cliente y devuelve su vista (404 si no existe). */
export async function bloquearCliente(t: Transaccion, id: number): Promise<ClienteVista> {
    const fila = await t.trx.from('core.clientes').where('id', id).forUpdate().select('id').first()
    if (!fila) throw new NoEncontrado(`El cliente ${id} no existe`)
    return verCliente(id, t.trx)
}

/**
 * `clientes.vincular_telegram`: fija `core.clientes.telegram_chat_id` (lo llama el webhook del bot
 * de A6 cuando el cliente se identifica, o un operador desde el panel). El chat id no es secreto:
 * el cambio queda en `audit.cambios` con su valor. Vincular el mismo chat no cambia nada; otro
 * chat reemplaza al anterior. Incrementa `version` si cambia.
 */
export default class VincularTelegramCliente extends DomainAction<EntradaVincularTelegram, ClienteVista> {
    readonly nombre = 'clientes.vincular_telegram'

    protected async handle(input: EntradaVincularTelegram, t: Transaccion): Promise<ClienteVista> {
        t.fijarEntidad('cliente', input.id)
        const chatId = String(input.chat_id).trim()
        if (!CHAT_ID_TELEGRAM.test(chatId)) {
            throw new ValidacionFallida([
                { field: 'chat_id', message: 'El chat id de Telegram es un número entero', rule: 'regex' },
            ])
        }
        const antes = await bloquearCliente(t, input.id)
        if (antes.telegram_chat_id === chatId) return antes
        await fijarChat(t, input.id, chatId)
        const despues = await verCliente(input.id, t.trx)
        await t.registrarCambios({ tipo: 'cliente', id: input.id }, antes, despues)
        return despues
    }
}

export async function fijarChat(t: Transaccion, id: number, chatId: string | null) {
    await t.trx
        .from('core.clientes')
        .where('id', id)
        .update({
            telegram_chat_id: chatId,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
}
