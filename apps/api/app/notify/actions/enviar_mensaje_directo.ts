import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { ErrorCanal } from '#notify/canales/canal'
import { resolverCanal } from '#notify/canales/registro'
import { renderizar } from '#notify/plantillas'

export type CanalDirecto = 'correo' | 'telegram'

export interface EntradaMensajeDirecto {
    /** cliente dueño del destino; null solo para mensajes internos (sin `notificacion.enviada`) */
    cliente_id: number | null
    canal: CanalDirecto
    /** correo o chat de Telegram ya resuelto; con `cliente_id`, debe ser el que el cliente tiene registrado */
    destino: string
    /** qué es el mensaje, para `notify.envios.evento` y el evento (`portal.codigo_acceso`) */
    motivo: string
    /** asunto (correo); Mustache con `{{secreto}}` si hace falta */
    asunto?: string | null
    /** cuerpo con `{{secreto}}` donde va el dato sensible (el código, una clave temporal) */
    cuerpo: string
    /**
     * Dato sensible que se pone en el cuerpo al enviar. **Nunca se guarda**: `notify.envios` guarda
     * el cuerpo sin renderizar (con `{{secreto}}`) y la auditoría lo registra como `***`.
     */
    secreto?: string | null
    /** empresa cuya configuración de canales se usa (null u omitida: la global) */
    empresa_id?: number | null
}

export interface ResultadoMensajeDirecto {
    envio_id: number
    estado: 'enviado' | 'fallido'
    /** mensaje del canal si falló */
    error: string | null
}

/**
 * `notificaciones.enviar_directo`: un mensaje a **un** canal y **un** destino ya resuelto, enviado
 * en el momento (sin cola ni reintentos diferidos). Para lo que no puede esperar al worker ni
 * caer a otro canal: el código de acceso del portal (`a5.md`), avisos operativos puntuales.
 *
 * - El dato sensible va aparte (`secreto`) y se interpola solo al enviar: ni `notify.envios` ni
 *   `audit.acciones` lo guardan (el campo `secreto` se enmascara como `***`).
 * - Con `cliente_id`, el destino tiene que ser el correo o el chat de Telegram **registrado** del
 *   cliente (422 si no): nunca a un destino que escriba quien pide el mensaje.
 * - Una fila en `notify.envios` (origen `directo:<uuid>`, estado `enviado` o `fallido`) y, con
 *   cliente, el evento `notificacion.enviada` con `evento_origen = motivo`.
 * - Si el canal falla no lanza: devuelve `fallido` con el error (queda registrado); quien llama
 *   decide (el portal muestra "no se pudo enviar"). Canal no configurado = `fallido`.
 * - Canal apagado en la configuración: no se envía; la fila queda `omitido` con el motivo y la
 *   acción devuelve `fallido` con ese motivo en `error` (para quien llama, no salió).
 */
export default class EnviarMensajeDirecto extends DomainAction<
    EntradaMensajeDirecto,
    ResultadoMensajeDirecto
> {
    readonly nombre = 'notificaciones.enviar_directo'

    protected async handle(input: EntradaMensajeDirecto, t: Transaccion): Promise<ResultadoMensajeDirecto> {
        const destino = input.destino?.trim() ?? ''
        const errores = []
        if (!['correo', 'telegram'].includes(input.canal)) {
            errores.push({ field: 'canal', message: 'Debe ser correo o telegram', rule: 'enum' })
        }
        if (!destino) errores.push({ field: 'destino', message: 'Obligatorio', rule: 'required' })
        if (!input.motivo?.trim()) errores.push({ field: 'motivo', message: 'Obligatorio', rule: 'required' })
        if (!input.cuerpo?.trim()) errores.push({ field: 'cuerpo', message: 'Obligatorio', rule: 'required' })
        if (errores.length > 0) throw new ValidacionFallida(errores)

        if (input.cliente_id !== null) {
            t.fijarEntidad('cliente', input.cliente_id)
            const cliente = (await t.trx
                .from('core.clientes')
                .where('id', input.cliente_id)
                .select('email', 'telegram_chat_id')
                .first()) as { email: string | null; telegram_chat_id: string | null } | null
            if (!cliente) {
                throw new ValidacionFallida([
                    {
                        field: 'cliente_id',
                        message: `El cliente ${input.cliente_id} no existe`,
                        rule: 'exists',
                    },
                ])
            }
            const registrado = input.canal === 'correo' ? cliente.email : cliente.telegram_chat_id
            const coincide =
                input.canal === 'correo'
                    ? registrado?.trim().toLowerCase() === destino.toLowerCase()
                    : registrado?.trim() === destino
            if (!coincide) {
                throw new ValidacionFallida([
                    {
                        field: 'destino',
                        message: `No es el ${input.canal === 'correo' ? 'correo' : 'chat de Telegram'} registrado del cliente`,
                        rule: 'destino_registrado',
                    },
                ])
            }
        }

        const variables = { secreto: input.secreto ?? '' }
        const asunto = input.asunto ? renderizar(input.asunto, variables) : null
        const cuerpo = renderizar(input.cuerpo, variables)

        let estado: 'enviado' | 'fallido' = 'enviado'
        let error: string | null = null
        let proveedorId: string | null = null
        const empresaId = input.empresa_id ?? null
        const resuelto = await resolverCanal(input.canal, { empresaId })
        if (resuelto.apagado) {
            estado = 'fallido'
            error = resuelto.motivo
        } else {
            try {
                if (!resuelto.canal) {
                    throw new ErrorCanal(input.canal, resuelto.motivo ?? 'canal no configurado', true)
                }
                const resultado = await resuelto.canal.enviar(destino, asunto, cuerpo)
                proveedorId = resultado.id || null
            } catch (falla) {
                estado = 'fallido'
                error = (falla instanceof Error ? falla.message : String(falla)).slice(0, 2000)
            }
        }

        const [fila] = (await t.trx
            .table('notify.envios')
            .insert({
                origen: `directo:${randomUUID()}`,
                evento: input.motivo.trim(),
                cliente_id: input.cliente_id,
                canal: input.canal,
                destino,
                // Sin renderizar: el secreto nunca queda en la base
                asunto: input.asunto ?? null,
                cuerpo: input.cuerpo,
                variables: JSON.stringify({ secreto: input.secreto ? '***' : null }),
                estado: resuelto.apagado ? 'omitido' : estado,
                error: resuelto.apagado ? null : error,
                motivo: resuelto.apagado ? resuelto.motivo : null,
                empresa_id: empresaId,
                intentos: resuelto.apagado ? 0 : 1,
                proveedor_id: proveedorId,
                enviado_en: estado === 'enviado' ? t.trx.knexRawQuery('now()') : null,
                request_id: t.ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>

        if (input.cliente_id !== null && !resuelto.apagado) {
            await t.emit('notificacion.enviada', {
                cliente_id: input.cliente_id,
                canal: input.canal,
                evento_origen: input.motivo.trim(),
                estado,
            })
        }
        return { envio_id: Number(fila!.id), estado, error }
    }
}
