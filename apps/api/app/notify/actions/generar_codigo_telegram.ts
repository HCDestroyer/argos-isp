import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, Problema, ValidacionFallida } from '#shared/errores'
import { configPara } from '#notify/configuracion'
import { empresaUnicaDelCliente } from '#notify/telegram/vinculos'
import {
    configBotDe,
    enlaceInicio,
    generarCodigoVinculacion,
    hashCodigoVinculacion,
} from '#notify/telegram/config'

export interface EntradaGenerarCodigoTelegram {
    cliente_id: number
    /**
     * Empresa cuyo bot se vincula (la de un servicio del cliente). Sin ella: la única empresa de
     * los servicios vigentes del cliente o, si tiene varias, el bot global.
     */
    empresa_id?: number | null
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
    /** empresa cuyo bot se vincula (null = el bot global) */
    empresa_id: number | null
}

/** 503 cuando el bot no está configurado (token y nombre del bot en la configuración de notificaciones). */
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
 * - Bot por empresa (`contratos/telegram.md`, "Varios bots"): el de la configuración de la empresa
 *   (`empresa_id` o la única de los servicios del cliente), que puede ser el global si hereda. El
 *   código solo se canjea en ese bot.
 * - Un solo código pendiente por cliente y bot: pedir otro marca el anterior `reemplazado`.
 * - El código no entra en la auditoría (la entrada es solo `cliente_id`).
 */
export default class GenerarCodigoTelegram extends DomainAction<
    EntradaGenerarCodigoTelegram,
    CodigoTelegram
> {
    readonly nombre = 'notificaciones.telegram_codigo'

    protected async handle(input: EntradaGenerarCodigoTelegram, t: Transaccion): Promise<CodigoTelegram> {
        t.fijarEntidad('cliente', input.cliente_id)
        const cliente = await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .forUpdate()
            .select('id')
            .first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)

        const empresaId = input.empresa_id ?? (await empresaUnicaDelCliente(t.trx, input.cliente_id))
        if (input.empresa_id) {
            const servicio = await t.trx
                .from('core.servicios')
                .where({ cliente_id: input.cliente_id, empresa_id: input.empresa_id })
                .select('id')
                .first()
            if (!servicio) {
                throw new ValidacionFallida([
                    {
                        field: 'empresa_id',
                        message: 'El cliente no tiene servicios en esa empresa',
                        rule: 'servicio_en_empresa',
                    },
                ])
            }
        }
        if (empresaId) t.fijarEmpresa(empresaId)
        const config = configBotDe(await configPara(empresaId))
        if (!config.token || !config.nombre || !config.botId) throw new TelegramNoConfigurado()

        await t.trx
            .from('notify.telegram_codigos')
            .where({ cliente_id: input.cliente_id, estado: 'pendiente' })
            .where((q) => q.where('bot_id', config.botId!).orWhereNull('bot_id'))
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
            bot_id: config.botId,
            empresa_id: empresaId,
        })
        return {
            codigo,
            enlace: enlaceInicio(config.nombre, codigo),
            bot: config.nombre,
            vence_en: vence.toISO()!,
            empresa_id: empresaId,
        }
    }
}
