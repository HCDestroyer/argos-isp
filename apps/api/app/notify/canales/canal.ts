import type { CanalNotificacion } from '#shared/eventos'

/**
 * Contrato de un canal de notificación (correo, Telegram y WhatsApp por la mensajería de Iris).
 *
 * - `enviar` entrega el mensaje al proveedor y devuelve su id (Message-ID SMTP, message_id de
 *   Telegram). Si falla lanza `ErrorCanal`; `permanente: true` significa que reintentar no sirve
 *   (destino inválido, bot bloqueado, 5xx SMTP) y el envío pasa directo a `fallido`.
 * - `estado` consulta la entrega de un id devuelto por `enviar`. Correo y Telegram no tienen
 *   acuse de entrega: responden `enviado` (aceptado por el proveedor).
 * - `opciones.remitenteNombre` (solo correo): nombre visible del remitente para este mensaje (el
 *   nombre comercial de la empresa del aviso); la dirección sigue siendo la de la configuración.
 * - `opciones.aviso` (solo WhatsApp por Iris, `canales/whatsapp.ts`): el aviso no lleva texto ni
 *   número; `cuerpo` es el código de la plantilla de Iris y `aviso` trae el id del envío (para la
 *   `Idempotency-Key`), los ids de Argos y las variables cerradas de esa plantilla. La respuesta
 *   puede traer `estado: 'en_cola'` (Iris lo entregará y avisará por webhook) o `'bloqueado'` con
 *   `motivo` (Iris no lo enviará: sin reintento ni respaldo).
 */
export interface Canal {
    readonly nombre: CanalNotificacion
    enviar(
        destino: string,
        asunto: string | null,
        cuerpo: string,
        opciones?: OpcionesEnvio,
    ): Promise<ResultadoEnvio>
    estado(id: string): Promise<EstadoEntrega>
}

export interface OpcionesEnvio {
    remitenteNombre?: string | null
    aviso?: AvisoIris
}

/** Datos de un aviso por la mensajería de Iris (contrato Iris 0.6.0 §6.2). */
export interface AvisoIris {
    envioId: number
    empresaId: number
    clienteId: number
    servicioId: number | null
    /** solo las claves declaradas en la plantilla de Iris (§6.3) */
    variables: Record<string, string>
}

export interface ResultadoEnvio {
    /** id del mensaje en el proveedor */
    id: string
    /**
     * Sin estado: el proveedor lo aceptó (correo, Telegram). `en_cola`: Iris lo tiene en cola y el
     * acuse llega por webhook. `bloqueado`: Iris no lo enviará (`motivo`).
     */
    estado?: 'en_cola' | 'bloqueado'
    motivo?: string | null
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
