import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, Problema } from '#shared/errores'
import {
    configBot,
    enlaceInicio,
    generarCodigoVinculacion,
    hashCodigoVinculacion,
} from '#notify/telegram/config'

export interface EntradaGenerarCodigoTelegram {
    cliente_id: number
}

export interface CodigoTelegram {
    /** código de un solo uso (10 caracteres `A-Z 2-9`); solo se muestra al cliente, no se guarda */
    codigo: string
    /** `https://t.me/<bot>?start=<código>` (abre el bot y manda `/start <código>`) */
    enlace: string
    /** usuario del bot sin `@` */
    bot: string
    /** ISO 8601 UTC */
    vence_en: string
}

/** 503 cuando el bot no está configurado (`TELEGRAM_BOT_TOKEN` y `TELEGRAM_BOT_NOMBRE`). */
export class TelegramNoConfigurado extends Problema {
    constructor() {
        super(
            503,
            'telegram_no_configurado',
            'Telegram no disponible',
            'La vinculación con Telegram no está disponible en este momento',
        )
    }
}

/**
 * `notificaciones.telegram_codigo`: código de vinculación del bot para un cliente
 * (`contratos/telegram.md`). Lo llama el portal (A5) con la sesión del cliente, o el panel.
 *
 * - Solo se guarda el SHA-256 del código; vence a los `TELEGRAM_CODIGO_VIGENCIA_S` (900 s).
 * - Un solo código pendiente por cliente: pedir otro marca el anterior `reemplazado`.
 * - El código no entra en la auditoría (la entrada es solo `cliente_id`).
 */
export default class GenerarCodigoTelegram extends DomainAction<
    EntradaGenerarCodigoTelegram,
    CodigoTelegram
> {
    readonly nombre = 'notificaciones.telegram_codigo'

    protected async handle(input: EntradaGenerarCodigoTelegram, t: Transaccion): Promise<CodigoTelegram> {
        const config = configBot()
        if (!config.token || !config.nombre) throw new TelegramNoConfigurado()
        t.fijarEntidad('cliente', input.cliente_id)

        const cliente = await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .forUpdate()
            .select('id')
            .first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)

        await t.trx
            .from('notify.telegram_codigos')
            .where({ cliente_id: input.cliente_id, estado: 'pendiente' })
            .update({ estado: 'reemplazado', updated_at: t.trx.knexRawQuery('now()') } as Record<
                string,
                unknown
            >)

        const codigo = generarCodigoVinculacion()
        const vence = DateTime.utc().plus({ seconds: config.vigenciaS }).startOf('second')
        await t.trx.table('notify.telegram_codigos').insert({
            cliente_id: input.cliente_id,
            codigo_hash: hashCodigoVinculacion(codigo),
            vence_en: vence.toISO(),
        })
        return {
            codigo,
            enlace: enlaceInicio(config.nombre, codigo),
            bot: config.nombre,
            vence_en: vence.toISO()!,
        }
    }
}
