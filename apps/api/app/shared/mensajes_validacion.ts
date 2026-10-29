import vine, { SimpleMessagesProvider } from '@vinejs/vine'
import type { FieldContext, MessagesProviderContact } from '@vinejs/vine/types'

/**
 * Mensajes por campo para un validador: explican por qué hace falta el dato
 * («El gateway es obligatorio: es la IP que reciben los clientes como puerta de enlace»).
 *
 * Las claves son `campo.regla` (`'gateway.required'`) o `campo` solo, que aplica a cualquier
 * regla del campo. Lo que no está aquí usa los mensajes generales de `start/validator.ts`.
 *
 * ```ts
 * export const crearRedIpv4Validator = conMensajes(vine.compile(...), {
 *     'cidr.required': 'La red es obligatoria: de ella salen las IPs de los clientes',
 * })
 * ```
 */
class MensajesPorCampo implements MessagesProviderContact {
    readonly #propios: SimpleMessagesProvider

    constructor(readonly mensajes: Record<string, string>) {
        this.#propios = new SimpleMessagesProvider(mensajes)
    }

    getMessage(
        mensaje: string,
        regla: string,
        campo: FieldContext,
        argumentos?: Record<string, unknown>,
    ): string {
        const ruta = campo.wildCardPath
        if (`${ruta}.${regla}` in this.mensajes) {
            return this.#propios.getMessage(mensaje, regla, campo, argumentos)
        }
        if (ruta in this.mensajes) {
            return new SimpleMessagesProvider({ [regla]: this.mensajes[ruta]! }).getMessage(
                mensaje,
                regla,
                campo,
                argumentos,
            )
        }
        return vine.messagesProvider.getMessage(mensaje, regla, campo, argumentos)
    }
}

export function conMensajes<V extends { messagesProvider: MessagesProviderContact }>(
    validador: V,
    mensajes: Record<string, string>,
): V {
    validador.messagesProvider = new MensajesPorCampo(mensajes)
    return validador
}

/** Mensajes comunes de los validadores con `version` (control optimista). */
export const MENSAJE_VERSION = {
    'version.required':
        'La versión es obligatoria: es la que leíste del registro y evita pisar los cambios de otra sesión',
}
