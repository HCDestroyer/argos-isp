import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { bloquearCliente, fijarChat } from '#core/actions/vincular_telegram_cliente'

export interface EntradaDesvincularTelegram {
    id: number
}

/**
 * `clientes.desvincular_telegram`: borra `core.clientes.telegram_chat_id` (el cliente deja el bot
 * o un operador lo quita). Idempotente: si no estaba vinculado no cambia nada (pero se audita).
 */
export default class DesvincularTelegramCliente extends DomainAction<
    EntradaDesvincularTelegram,
    ClienteVista
> {
    readonly nombre = 'clientes.desvincular_telegram'

    protected async handle(input: EntradaDesvincularTelegram, t: Transaccion): Promise<ClienteVista> {
        t.fijarEntidad('cliente', input.id)
        const antes = await bloquearCliente(t, input.id)
        if (antes.telegram_chat_id === null) return antes
        await fijarChat(t, input.id, null)
        const despues = await verCliente(input.id, t.trx)
        await t.registrarCambios({ tipo: 'cliente', id: input.id }, antes, despues)
        return despues
    }
}
