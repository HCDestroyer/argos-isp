import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import VincularTelegramCliente, { CHAT_ID_TELEGRAM } from '#core/actions/vincular_telegram_cliente'
import { nombreParcial } from '#portal/consultas'
import { FORMATO_VINCULO, hashVinculo } from '#portal/acceso/telegram'

export interface EntradaCanjearVinculo {
    /** el código de `/start <código>`; se llama `secreto` para que la auditoría lo guarde como `***` */
    secreto: string
    /** id del chat privado de Telegram, como texto */
    chat_id: string
}

export interface ResultadoCanje {
    cliente_id: number
    nombre_parcial: string | null
    /** el mismo chat ya había canjeado este código (Telegram reintentó el update) */
    ya_vinculado: boolean
}

interface FilaVinculo {
    id: number
    cliente_id: number
    expira_en: Date
    usado_en: Date | null
    chat_id: string | null
    reemplazado_en: Date | null
}

/**
 * Canjea el código de vinculación que el bot de A6 recibe en `/start <código>` y vincula el chat
 * con `VincularTelegramCliente` de A1 en la misma transacción. Contrato en
 * `.claude/integration/contratos/telegram.md`.
 *
 * - El cliente lo decide el código, nunca el bot.
 * - Uso único: un código usado, vencido o reemplazado → 422 `vinculo_invalido`. Si el que repite
 *   es el mismo chat que lo canjeó (reintento de Telegram), devuelve el resultado con
 *   `ya_vinculado: true`.
 * - Solo chats privados (id positivo): un grupo → 422 `chat_id` rule `privado`.
 */
export default class CanjearVinculoTelegram extends DomainAction<EntradaCanjearVinculo, ResultadoCanje> {
    readonly nombre = 'portal.canjear_vinculo_telegram'

    protected async handle(input: EntradaCanjearVinculo, t: Transaccion): Promise<ResultadoCanje> {
        const chatId = String(input.chat_id ?? '').trim()
        if (!CHAT_ID_TELEGRAM.test(chatId) || chatId.startsWith('-')) {
            throw new ValidacionFallida([
                {
                    field: 'chat_id',
                    message: 'Para vincular tu cuenta escríbeme por mensaje privado.',
                    rule: 'privado',
                },
            ])
        }
        const codigo = String(input.secreto ?? '').trim()
        if (!FORMATO_VINCULO.test(codigo)) throw new VinculoTelegramInvalido()

        const fila = (await t.trx
            .from('core.portal_vinculos_telegram')
            .where('codigo_hash', hashVinculo(codigo))
            .forUpdate()
            .select('id', 'cliente_id', 'expira_en', 'usado_en', 'chat_id', 'reemplazado_en')
            .first()) as FilaVinculo | null
        if (!fila) throw new VinculoTelegramInvalido()
        const clienteId = Number(fila.cliente_id)
        t.fijarEntidad('cliente', clienteId)

        if (fila.usado_en) {
            if (fila.chat_id !== chatId) throw new VinculoTelegramInvalido()
            return { cliente_id: clienteId, nombre_parcial: await nombreDe(t, clienteId), ya_vinculado: true }
        }
        if (fila.reemplazado_en || new Date(fila.expira_en).getTime() <= Date.now()) {
            throw new VinculoTelegramInvalido()
        }

        await t.trx
            .from('core.portal_vinculos_telegram')
            .where('id', fila.id)
            .update({ usado_en: t.trx.knexRawQuery('now()'), chat_id: chatId })
        await new VincularTelegramCliente().execute({ id: clienteId, chat_id: chatId }, t.ctx, { trx: t.trx })
        return { cliente_id: clienteId, nombre_parcial: await nombreDe(t, clienteId), ya_vinculado: false }
    }
}

async function nombreDe(t: Transaccion, clienteId: number): Promise<string | null> {
    const cliente = (await t.trx.from('core.clientes').where('id', clienteId).select('nombre').first()) as {
        nombre: string
    }
    return nombreParcial(cliente.nombre)
}

/** 422: el código no existe, venció, fue reemplazado o lo usó otro chat. */
export class VinculoTelegramInvalido extends Problema {
    constructor() {
        super(
            422,
            'vinculo_invalido',
            'Enlace de vinculación no válido',
            'El enlace venció o ya se usó. Abre el portal y pulsa Vincular Telegram otra vez.',
        )
    }
}
