import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import type { CanalNotificacion } from '#shared/eventos'
import { ErrorCanal } from '#notify/canales/canal'
import { obtenerCanal } from '#notify/canales/registro'
import { crearEnvio, plantillasActivas } from '#notify/envios'
import { cargarDestinatario, type Variables } from '#notify/variables'

export interface EntradaEnviar {
    envioId: number
    /** número de intento actual (1 = primero) */
    intento: number
    /** intentos totales permitidos; en el último, un error transitorio también marca `fallido` */
    maxIntentos: number
}

export interface ResultadoEnviar {
    estado: 'enviado' | 'fallido' | 'reintentar' | 'omitido'
    error?: string
    /** envío por correo creado como fallback de un canal que falló; hay que encolarlo */
    fallbackId?: number
}

interface FilaEnvio {
    id: number
    origen: string
    evento: string
    cliente_id: number | null
    canal: CanalNotificacion
    destino: string
    asunto: string | null
    cuerpo: string | null
    variables: Variables
    estado: 'encolado' | 'enviado' | 'fallido'
}

/**
 * Entrega un envío `encolado` por su canal y registra el resultado.
 *
 * - Bloquea la fila (`FOR UPDATE`): dos workers no envían el mismo mensaje. Si ya no está
 *   `encolado` no hace nada (`omitido`): el job puede llegar dos veces.
 * - Éxito → `enviado`, `proveedor_id`, `enviado_en`; emite `notificacion.enviada` (enviado).
 * - Error transitorio antes del último intento → sigue `encolado` con el error y el número de
 *   intentos; devuelve `reintentar` y el worker lanza para que BullMQ reintente con backoff.
 * - Error permanente o último intento → `fallido`; emite `notificacion.enviada` (fallido) y, si
 *   el canal no era correo, crea el envío de fallback por correo (`fallbackId`).
 */
export default class EnviarNotificacion extends DomainAction<EntradaEnviar, ResultadoEnviar> {
    readonly nombre = 'notificaciones.enviar'

    protected async handle(input: EntradaEnviar, t: Transaccion): Promise<ResultadoEnviar> {
        const envio = (await t.trx
            .from('notify.envios')
            .where('id', input.envioId)
            .forUpdate()
            .select(
                'id',
                'origen',
                'evento',
                'cliente_id',
                'canal',
                'destino',
                'asunto',
                'cuerpo',
                'variables',
                'estado',
            )
            .first()) as FilaEnvio | null
        if (!envio) throw new NoEncontrado(`notify.envios ${input.envioId} no existe`)
        t.fijarEntidad('envio', envio.id)
        if (envio.estado !== 'encolado') return { estado: 'omitido' }

        const canal = obtenerCanal(envio.canal)
        try {
            if (!canal) throw new ErrorCanal(envio.canal, 'canal no configurado en este entorno', true)
            const resultado = await canal.enviar(envio.destino, envio.asunto, envio.cuerpo ?? '')
            await t.trx
                .from('notify.envios')
                .where('id', envio.id)
                .update({
                    estado: 'enviado',
                    proveedor_id: resultado.id || null,
                    enviado_en: t.trx.knexRawQuery('now()'),
                    intentos: input.intento,
                    error: null,
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await this.emitir(t, envio, 'enviado')
            return { estado: 'enviado' }
        } catch (error) {
            const mensaje = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
            const permanente = error instanceof ErrorCanal && error.permanente
            const definitivo = permanente || input.intento >= input.maxIntentos

            await t.trx
                .from('notify.envios')
                .where('id', envio.id)
                .update({
                    estado: definitivo ? 'fallido' : 'encolado',
                    intentos: input.intento,
                    error: mensaje,
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            if (!definitivo) return { estado: 'reintentar', error: mensaje }

            await this.emitir(t, envio, 'fallido')
            const fallbackId = await this.fallbackCorreo(t, envio)
            return { estado: 'fallido', error: mensaje, fallbackId }
        }
    }

    private async emitir(t: Transaccion, envio: FilaEnvio, estado: 'enviado' | 'fallido') {
        // Las alertas internas (sin cliente) no son notificaciones a clientes.
        if (envio.cliente_id === null) return
        await t.emit('notificacion.enviada', {
            cliente_id: envio.cliente_id,
            canal: envio.canal,
            evento_origen: envio.evento,
            estado,
        })
    }

    /** Si falló un canal distinto de correo, notifica por correo con la plantilla de correo. */
    private async fallbackCorreo(t: Transaccion, envio: FilaEnvio): Promise<number | undefined> {
        if (envio.canal === 'correo' || envio.cliente_id === null) return undefined
        const destinatario = await cargarDestinatario(t.trx, envio.cliente_id)
        const plantillas = await plantillasActivas(t.trx, envio.evento)
        const plantilla = plantillas.get('correo')
        if (!destinatario?.email || !plantilla || !obtenerCanal('correo')) return undefined

        const nuevo = await crearEnvio(t.trx, {
            origen: envio.origen,
            evento: envio.evento,
            clienteId: envio.cliente_id,
            canal: 'correo',
            destino: destinatario.email,
            variables: envio.variables,
            plantilla,
            requestId: t.ctx.requestId,
            fallbackDe: envio.id,
        })
        return nuevo.estado === 'encolado' ? nuevo.id : undefined
    }
}
