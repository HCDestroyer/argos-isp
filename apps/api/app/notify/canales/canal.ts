import type { CanalNotificacion } from '#shared/eventos'

/**
 * Contrato de un canal de notificación (correo, Telegram, WhatsApp más adelante).
 *
 * - `enviar` entrega el mensaje al proveedor y devuelve su id (Message-ID SMTP, message_id de
 *   Telegram). Si falla lanza `ErrorCanal`; `permanente: true` significa que reintentar no sirve
 *   (destino inválido, bot bloqueado, 5xx SMTP) y el envío pasa directo a `fallido`.
 * - `estado` consulta la entrega de un id devuelto por `enviar`. Correo y Telegram no tienen
 *   acuse de entrega: responden `enviado` (aceptado por el proveedor).
 */
export interface Canal {
    readonly nombre: CanalNotificacion
    enviar(destino: string, asunto: string | null, cuerpo: string): Promise<ResultadoEnvio>
    estado(id: string): Promise<EstadoEntrega>
}

export interface ResultadoEnvio {
    /** id del mensaje en el proveedor */
    id: string
}

export type EstadoEntrega = 'enviado' | 'entregado' | 'fallido' | 'desconocido'

export class ErrorCanal extends Error {
    constructor(
        readonly canal: CanalNotificacion,
        mensaje: string,
        readonly permanente: boolean,
        options?: { cause?: unknown },
    ) {
        super(`${canal}: ${mensaje}`, options)
        this.name = 'ErrorCanal'
    }
}
