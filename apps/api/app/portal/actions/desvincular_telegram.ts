import { DomainAction, type Transaccion } from '#shared/domain_action'
import DesvincularTelegramCliente from '#core/actions/desvincular_telegram_cliente'
import EditarCliente from '#core/actions/editar_cliente'
import AnularCodigosTelegram from '#notify/actions/anular_codigos_telegram'
import { estadoTelegram, type EstadoTelegramPortal } from '#portal/acceso/telegram'

export interface EntradaDesvincularPortal {
    clienteId: number
}

/**
 * El cliente quita Telegram desde el portal (`POST /portal/telegram/desvincular`).
 *
 * Delega en `DesvincularTelegramCliente` de A1 (misma transacción). Si el canal preferido era
 * `telegram`, lo cambia a `correo` con `EditarCliente` para que los avisos no apunten a un canal
 * sin destino. Anula los códigos de vinculación pendientes con `AnularCodigosTelegram` de A6
 * (misma transacción): un enlace `t.me/<bot>?start=<código>` viejo no vuelve a vincular el chat.
 */
export default class DesvincularTelegramPortal extends DomainAction<
    EntradaDesvincularPortal,
    EstadoTelegramPortal
> {
    readonly nombre = 'portal.desvincular_telegram'

    protected async handle(input: EntradaDesvincularPortal, t: Transaccion): Promise<EstadoTelegramPortal> {
        t.fijarEntidad('cliente', input.clienteId)
        const despues = await new DesvincularTelegramCliente().execute({ id: input.clienteId }, t.ctx, {
            trx: t.trx,
        })
        await new AnularCodigosTelegram().execute({ cliente_id: input.clienteId }, t.ctx, { trx: t.trx })
        if (despues.canal_preferido === 'telegram') {
            await new EditarCliente().execute(
                { id: input.clienteId, version: despues.version, canal_preferido: 'correo' },
                t.ctx,
                { trx: t.trx },
            )
        }
        return estadoTelegram(input.clienteId, t.trx)
    }
}
