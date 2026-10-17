import { DomainAction, type Transaccion } from '#shared/domain_action'

export interface EntradaAnularCodigosTelegram {
    cliente_id: number
    /** solo los códigos de este bot (y los anteriores a los bots por empresa); sin él, todos */
    bot_id?: string | null
}

export interface ResultadoAnularCodigosTelegram {
    /** códigos pendientes que quedaron `anulado` (0 si no había) */
    anulados: number
}

/**
 * `notificaciones.telegram_anular_codigos`: anula los códigos de vinculación **pendientes** de un
 * cliente (`notify.telegram_codigos.estado = anulado`). Va junto a cada desvinculación de Telegram
 * (bot `/desvincular`, portal, panel) para que un enlace viejo `t.me/<bot>?start=<código>` no vuelva
 * a vincular el chat mientras no venza. Correr dentro de la misma transacción que la
 * desvinculación (`{ trx }`). Idempotente: sin pendientes no cambia nada.
 */
export default class AnularCodigosTelegram extends DomainAction<
    EntradaAnularCodigosTelegram,
    ResultadoAnularCodigosTelegram
> {
    readonly nombre = 'notificaciones.telegram_anular_codigos'

    protected async handle(
        input: EntradaAnularCodigosTelegram,
        t: Transaccion,
    ): Promise<ResultadoAnularCodigosTelegram> {
        t.fijarEntidad('cliente', input.cliente_id)
        const consulta = t.trx
            .from('notify.telegram_codigos')
            .where({ cliente_id: input.cliente_id, estado: 'pendiente' })
        if (input.bot_id) consulta.where((q) => q.where('bot_id', input.bot_id!).orWhereNull('bot_id'))
        const anulados = await consulta.update({
            estado: 'anulado',
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
        return { anulados: Number(anulados) }
    }
}
