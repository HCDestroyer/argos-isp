import { DomainAction, type Transaccion } from '#shared/domain_action'
import DesvincularTelegramCliente from '#core/actions/desvincular_telegram_cliente'
import AnularCodigosTelegram from '#notify/actions/anular_codigos_telegram'

export interface EntradaDesvincularTelegramBot {
    cliente_id: number
    /** bot del que se desvincula; null = el bot global sin id conocido (desvincula todo) */
    bot_id: string | null
}

export interface ResultadoDesvincularTelegramBot {
    /** quedó sin ningún bot: también se borró `core.clientes.telegram_chat_id` */
    desvinculado_del_todo: boolean
    /** bots que siguen vinculados */
    bots_restantes: string[]
}

/**
 * `notificaciones.telegram_desvincular`: `/desvincular` en un bot (Telegram por empresa). Borra el
 * vínculo del cliente con **ese** bot (`notify.telegram_vinculos`) y anula sus códigos pendientes
 * de ese bot. Si no le queda ningún bot vinculado, desvincula al cliente del todo con
 * `DesvincularTelegramCliente` (A1) y anula todos sus códigos, como antes de los bots por empresa.
 * Idempotente.
 */
export default class DesvincularTelegramBot extends DomainAction<
    EntradaDesvincularTelegramBot,
    ResultadoDesvincularTelegramBot
> {
    readonly nombre = 'notificaciones.telegram_desvincular'

    protected async handle(
        input: EntradaDesvincularTelegramBot,
        t: Transaccion,
    ): Promise<ResultadoDesvincularTelegramBot> {
        t.fijarEntidad('cliente', input.cliente_id)
        // Serializa contra un canje simultáneo del mismo cliente
        await t.trx.from('core.clientes').where('id', input.cliente_id).forUpdate().select('id').first()
        if (input.bot_id) {
            await t.trx
                .from('notify.telegram_vinculos')
                .where({ cliente_id: input.cliente_id, bot_id: input.bot_id })
                .delete()
        }
        const restantes = input.bot_id
            ? ((await t.trx
                  .from('notify.telegram_vinculos')
                  .where('cliente_id', input.cliente_id)
                  .orderBy('id')
                  .select('bot_id')) as Array<{ bot_id: string }>)
            : []
        if (restantes.length > 0) {
            await new AnularCodigosTelegram().execute(
                { cliente_id: input.cliente_id, bot_id: input.bot_id },
                t.ctx,
                { trx: t.trx },
            )
            return { desvinculado_del_todo: false, bots_restantes: restantes.map((r) => r.bot_id) }
        }
        await t.trx.from('notify.telegram_vinculos').where('cliente_id', input.cliente_id).delete()
        await new DesvincularTelegramCliente().execute({ id: input.cliente_id }, t.ctx, { trx: t.trx })
        await new AnularCodigosTelegram().execute({ cliente_id: input.cliente_id }, t.ctx, { trx: t.trx })
        return { desvinculado_del_todo: true, bots_restantes: [] }
    }
}
