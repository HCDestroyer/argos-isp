import { obtenerCanal } from '#notify/canales/registro'

/**
 * Puerto para enviar el código de verificación del portal a un destino REGISTRADO del cliente
 * (correo o Telegram de `core.clientes`). Nunca a un destino que escriba el cliente.
 *
 * Por qué no `ProgramarNotificacion` de notify: guarda el cuerpo renderizado en `notify.envios`
 * (el código quedaría en claro en la base) y envía por todos los canales desde un worker, con
 * reintentos de minutos. El código necesita un envío directo, a un solo canal, sin guardar el
 * texto. Pedido a A6 en `.claude/integration/a5.md`: una acción pública de mensaje directo. Mientras
 * tanto `EnviadorCodigoNotify` usa la interfaz pública `Canal` de notify (`canales/canal.ts`).
 *
 * Las pruebas reemplazan el puerto con `usarEnviadorCodigo(falso)`.
 */

export type CanalCodigo = 'correo' | 'telegram'

export interface MensajeCodigo {
    canal: CanalCodigo
    destino: string
    asunto: string
    cuerpo: string
}

export interface EnviadorCodigo {
    /** Canales que se pueden usar ahora (adaptador configurado). */
    disponibles(): CanalCodigo[]
    /** Entrega el mensaje o lanza. */
    enviar(mensaje: MensajeCodigo): Promise<void>
}

/** Envío directo por los canales de notify (`SMTP_HOST`, `TELEGRAM_BOT_TOKEN`). */
export class EnviadorCodigoNotify implements EnviadorCodigo {
    disponibles(): CanalCodigo[] {
        return (['correo', 'telegram'] as const).filter((canal) => obtenerCanal(canal) !== undefined)
    }

    async enviar(mensaje: MensajeCodigo): Promise<void> {
        const canal = obtenerCanal(mensaje.canal)
        if (!canal) throw new Error(`El canal ${mensaje.canal} no está configurado`)
        await canal.enviar(mensaje.destino, mensaje.asunto, mensaje.cuerpo)
    }
}

let actual: EnviadorCodigo | undefined

export function enviadorCodigo(): EnviadorCodigo {
    actual ??= new EnviadorCodigoNotify()
    return actual
}

/** Reemplaza el enviador (pruebas). `undefined` vuelve al de notify. */
export function usarEnviadorCodigo(enviador: EnviadorCodigo | undefined): void {
    actual = enviador
}
