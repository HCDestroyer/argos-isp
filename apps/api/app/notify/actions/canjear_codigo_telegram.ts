import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import VincularTelegramCliente from '#core/actions/vincular_telegram_cliente'
import { hashCodigoVinculacion, normalizarCodigo } from '#notify/telegram/config'

export interface EntradaCanjearCodigoTelegram {
    /** el código del enlace `?start=`; se audita como `***` */
    token_vinculacion: string
    /** chat privado que manda `/start <código>` */
    chat_id: string
}

export interface ResultadoCanje {
    cliente_id: number
    /** primer nombre del cliente, para el saludo (sin apellidos ni otros datos) */
    nombre: string
    /** el mismo chat ya había canjeado este código (Telegram reintentó el webhook) */
    repetido: boolean
}

/**
 * 422 `codigo_invalido`: no existe, venció, fue reemplazado, lo usó otro chat o el vínculo del
 * cliente cambió después de emitirlo (desvinculación).
 */
export class CodigoTelegramInvalido extends ReglaNegocio {
    constructor() {
        super('El código de vinculación no es válido o ya venció', 'codigo_invalido')
    }
}

interface FilaCodigo {
    id: number
    cliente_id: number
    estado: 'pendiente' | 'usado' | 'reemplazado'
    vence_en: Date
    chat_id: string | null
}

/**
 * `notificaciones.telegram_vincular`: canjea un código de `GenerarCodigoTelegram` desde el
 * webhook del bot y vincula el chat con `VincularTelegramCliente` (A1) en la misma transacción
 * (`contratos/telegram.md`). Idempotente para el mismo chat; cualquier otro caso es 422.
 */
export default class CanjearCodigoTelegram extends DomainAction<
    EntradaCanjearCodigoTelegram,
    ResultadoCanje
> {
    readonly nombre = 'notificaciones.telegram_vincular'

    protected async handle(input: EntradaCanjearCodigoTelegram, t: Transaccion): Promise<ResultadoCanje> {
        const codigo = normalizarCodigo(input.token_vinculacion)
        if (!codigo) throw new CodigoTelegramInvalido()
        const fila = (await t.trx
            .from('notify.telegram_codigos')
            .where('codigo_hash', hashCodigoVinculacion(codigo))
            .forUpdate()
            .select('id', 'cliente_id', 'estado', 'vence_en', 'chat_id')
            .first()) as FilaCodigo | null
        if (!fila) throw new CodigoTelegramInvalido()
        t.fijarEntidad('cliente', fila.cliente_id)

        // Reintento del mismo chat, salvo que el vínculo haya cambiado desde el canje (desvinculó).
        if (
            fila.estado === 'usado' &&
            fila.chat_id === input.chat_id &&
            !(await vinculoCambiadoDespues(t, fila, 'usado_en'))
        ) {
            return {
                cliente_id: fila.cliente_id,
                nombre: await primerNombre(t, fila.cliente_id),
                repetido: true,
            }
        }
        if (fila.estado !== 'pendiente' || new Date(fila.vence_en).getTime() <= Date.now()) {
            throw new CodigoTelegramInvalido()
        }
        // Un cambio de vínculo posterior al código (desvincular desde el portal, el panel o el bot,
        // o vincular otro chat) lo anula: un enlace viejo no vuelve a vincular la cuenta.
        // (Es la regla, no una marca: cubre cualquier camino de desvinculación sin depender de él.)
        if (await vinculoCambiadoDespues(t, fila, 'created_at')) {
            throw new CodigoTelegramInvalido()
        }

        await new VincularTelegramCliente().execute({ id: fila.cliente_id, chat_id: input.chat_id }, t.ctx, {
            trx: t.trx,
        })
        await t.trx
            .from('notify.telegram_codigos')
            .where('id', fila.id)
            .update({
                estado: 'usado',
                usado_en: t.trx.knexRawQuery('now()'),
                chat_id: input.chat_id,
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        return {
            cliente_id: fila.cliente_id,
            nombre: await primerNombre(t, fila.cliente_id),
            repetido: false,
        }
    }
}

/**
 * ¿Cambió `telegram_chat_id` del cliente (audit.cambios) después de `desde` del código? Se compara
 * en SQL: en JS el instante pierde los microsegundos y el cambio del propio canje parecería
 * posterior.
 */
async function vinculoCambiadoDespues(
    t: Transaccion,
    fila: FilaCodigo,
    desde: 'created_at' | 'usado_en',
): Promise<boolean> {
    const cambio = await t.trx
        .from('audit.cambios')
        .where({ entidad_tipo: 'cliente', entidad_id: fila.cliente_id, campo: 'telegram_chat_id' })
        .whereRaw(`created_at > (SELECT ${desde} FROM notify.telegram_codigos WHERE id = ?)`, [fila.id])
        .select('id')
        .first()
    return Boolean(cambio)
}

async function primerNombre(t: Transaccion, clienteId: number): Promise<string> {
    const fila = (await t.trx.from('core.clientes').where('id', clienteId).select('nombre').first()) as {
        nombre: string
    } | null
    return (fila?.nombre ?? '').trim().split(/\s+/)[0] ?? ''
}
