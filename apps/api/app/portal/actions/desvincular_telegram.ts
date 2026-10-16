import { DomainAction, type Transaccion } from '#shared/domain_action'
import DesvincularTelegramCliente from '#core/actions/desvincular_telegram_cliente'
import EditarCliente from '#core/actions/editar_cliente'
import { estadoTelegram, type EstadoTelegramPortal } from '#portal/acceso/telegram'

export interface EntradaDesvincularPortal {
    clienteId: number
}

/**
 * El cliente quita Telegram desde el portal (`POST /portal/telegram/desvincular`).
 *
 * Delega en `DesvincularTelegramCliente` de A1 (misma transacción). Si el canal preferido era
 * `telegram`, lo cambia a `correo` con `EditarCliente` para que los avisos no apunten a un canal
 * sin destino. Los códigos pendientes son de A6 (`notify.telegram_codigos`) y vencen solos.
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
