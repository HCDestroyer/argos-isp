import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import {
    botTelegram,
    enlaceVinculo,
    generarCodigoVinculo,
    hashVinculo,
    vigenciaVinculoS,
} from '#portal/acceso/telegram'

export interface EntradaGenerarVinculo {
    clienteId: number
    sesionId: number
}

/** Espejo del schema `PortalVinculoTelegram`. */
export interface VinculoTelegram {
    enlace: string
    bot: string
    expira_en: string
}

/**
 * El cliente con sesión pide un enlace para vincular Telegram (`POST /portal/telegram/vincular`).
 *
 * Genera un código de un solo uso (solo se guarda su hash), reemplaza los anteriores sin usar del
 * mismo cliente y devuelve el enlace profundo `https://t.me/<bot>?start=<código>`. La salida no se
 * audita (solo la entrada), así que el código no queda en `audit.acciones`.
 */
export default class GenerarVinculoTelegram extends DomainAction<EntradaGenerarVinculo, VinculoTelegram> {
    readonly nombre = 'portal.generar_vinculo_telegram'

    protected async handle(input: EntradaGenerarVinculo, t: Transaccion): Promise<VinculoTelegram> {
        t.fijarEntidad('cliente', input.clienteId)
        const bot = botTelegram()
        if (!bot) throw new TelegramNoConfigurado()

        await t.trx.from('core.clientes').where('id', input.clienteId).forUpdate().select('id')
        await t.trx
            .from('core.portal_vinculos_telegram')
            .where('cliente_id', input.clienteId)
            .whereNull('usado_en')
            .whereNull('reemplazado_en')
            .update({ reemplazado_en: t.trx.knexRawQuery('now()') })

        const codigo = generarCodigoVinculo()
        const expira = DateTime.utc().plus({ seconds: vigenciaVinculoS() })
        await t.trx
            .insertQuery()
            .table('core.portal_vinculos_telegram')
            .insert({
                cliente_id: input.clienteId,
                codigo_hash: hashVinculo(codigo),
                sesion_id: input.sesionId,
                expira_en: expira.toJSDate(),
            })
        return { enlace: enlaceVinculo(bot, codigo), bot, expira_en: expira.toISO()! }
    }
}

/** 503: no hay `PORTAL_TELEGRAM_BOT`. */
export class TelegramNoConfigurado extends Problema {
    constructor() {
        super(
            503,
            'telegram_no_configurado',
            'Telegram no disponible',
            'La vinculación con Telegram aún no está disponible. Intenta más tarde.',
        )
    }
}
