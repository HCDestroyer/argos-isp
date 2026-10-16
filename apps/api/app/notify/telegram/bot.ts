import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { ContextoAccion } from '#shared/contexto'
import { Problema } from '#shared/errores'
import { fechaHora, quetzales } from '#notify/formato'
import { obtenerCanal } from '#notify/canales/registro'
import CanjearCodigoTelegram, { CodigoTelegramInvalido } from '#notify/actions/canjear_codigo_telegram'
import DesvincularTelegramCliente from '#core/actions/desvincular_telegram_cliente'
import AnularCodigosTelegram from '#notify/actions/anular_codigos_telegram'
import { cuentasDelChat, type CuentaChat } from '#notify/telegram/estado'
import { configBot } from '#notify/telegram/config'

/**
 * Bot de Telegram (webhook, `contratos/telegram.md`). Recibe una actualización ya validada y
 * autenticada, decide el comando y responde por la Bot API (canal `telegram` de notify).
 *
 * Comandos: `/start <código>` vincula, `/start` solo da la bienvenida, `/estado` (solo chats
 * vinculados), `/desvincular`, `/ayuda`. Solo chats privados: en un grupo el bot no vincula ni
 * muestra cuentas. Textos en español, sin datos sensibles (ni NIT, ni usuario PPPoE, ni IPs).
 */

export interface ActualizacionTelegram {
    update_id: number
    message?: {
        message_id: number
        chat: { id: number; type: string }
        text?: string
    }
}

export type Comando = 'start' | 'vincular' | 'estado' | 'desvincular' | 'ayuda' | 'grupo' | 'ignorado'

export interface ResultadoBot {
    comando: Comando
    /** texto que se respondió (o se intentó responder); null si no hubo respuesta */
    respuesta: string | null
}

export const COMANDOS_BOT = [
    { command: 'estado', description: 'Estado de tu servicio y saldo' },
    { command: 'ayuda', description: 'Qué puedo hacer' },
    { command: 'desvincular', description: 'Dejar de recibir avisos en este chat' },
] as const

function enlacePortal(): string {
    const url = configBot().portalUrl
    return url
        ? `Entra al portal (${url}), abre "Mis datos" y toca "Vincular Telegram".`
        : 'Entra al portal de clientes, abre "Mis datos" y toca "Vincular Telegram".'
}

export const MENSAJES = {
    bienvenida: () =>
        'Hola. Soy el asistente de tu proveedor de internet.\n\n' +
        `Para recibir aquí tus avisos de factura y pago, vincula este chat: ${enlacePortal()}`,
    vinculado: (nombre: string) =>
        `Listo${nombre ? `, ${nombre}` : ''}. Este chat quedó vinculado a tu cuenta: aquí recibirás tus avisos de factura, recordatorios y pagos.\n\n` +
        'Escribe /estado para ver tu servicio y tu saldo, o /ayuda para ver qué más puedo hacer.',
    codigoInvalido: () => `Ese código no es válido o ya venció. Pide uno nuevo: ${enlacePortal()}`,
    noVinculado: () => `Este chat no está vinculado a ninguna cuenta. ${enlacePortal()}`,
    desvinculado: () =>
        'Listo. Este chat ya no recibirá avisos de tu cuenta. Puedes vincularlo de nuevo desde el portal cuando quieras.',
    grupo: () =>
        'Por tu privacidad, solo atiendo en un chat privado. Escríbeme directamente para vincular tu cuenta o ver tu estado.',
    errorTemporal: () => 'No pude consultar tu cuenta en este momento. Intenta de nuevo en unos minutos.',
    ayuda: () =>
        'Esto es lo que puedo hacer:\n\n' +
        '/estado: estado de tu servicio y saldo pendiente\n' +
        '/desvincular: dejar de recibir avisos en este chat\n' +
        '/ayuda: este mensaje\n\n' +
        `Para vincular este chat a tu cuenta: ${enlacePortal()}`,
}

const NOMBRE_ESTADO: Record<string, string> = {
    activo: 'activo',
    limitado: 'con velocidad limitada',
    suspendido: 'suspendido por falta de pago',
}

export function textoEstado(cuentas: CuentaChat[]): string {
    const bloques = cuentas.map((cuenta) => {
        const lineas = [`Cuenta de ${cuenta.nombre || 'cliente'}:`]
        if (cuenta.servicios.length === 0) lineas.push('Sin servicios activos.')
        for (const servicio of cuenta.servicios) {
            let linea = `- Servicio ${servicio.id} (${servicio.plan}): ${NOMBRE_ESTADO[servicio.estado] ?? servicio.estado}`
            if (servicio.promesa_vence_en) {
                linea += `, con promesa de pago hasta ${fechaHora(servicio.promesa_vence_en)}`
            }
            lineas.push(linea)
        }
        const debe = cuenta.saldo.isPositive() && !cuenta.saldo.isZero()
        if (debe) lineas.push(`Saldo pendiente: ${quetzales(cuenta.saldo)}`)
        // Un saldo de CxC negativo (pagó de más sin anticipo registrado) también es a favor.
        const aFavor = cuenta.a_favor.plus(cuenta.saldo.isNegative() ? cuenta.saldo.abs() : 0)
        if (!aFavor.isZero() && aFavor.isPositive()) lineas.push(`Saldo a favor: ${quetzales(aFavor)}`)
        if (!debe) lineas.push('Estás al día con tus pagos.')
        return lineas.join('\n')
    })
    return bloques.join('\n\n')
}

/** `/start@MiBot ABC` → `{ comando: 'start', argumento: 'ABC' }`. */
export function leerComando(texto: string): { comando: string; argumento: string } | null {
    const coincidencia = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(texto.trim())
    if (!coincidencia) return null
    return { comando: coincidencia[1]!.toLowerCase(), argumento: (coincidencia[2] ?? '').trim() }
}

export async function procesarActualizacion(
    actualizacion: ActualizacionTelegram,
    ctx: ContextoAccion,
): Promise<ResultadoBot> {
    const mensaje = actualizacion.message
    if (!mensaje || typeof mensaje.text !== 'string') return { comando: 'ignorado', respuesta: null }
    const chatId = String(mensaje.chat.id)

    if (mensaje.chat.type !== 'private') {
        // En grupos solo responde si le hablan con un comando (no a cada mensaje del grupo).
        if (!leerComando(mensaje.text)) return { comando: 'ignorado', respuesta: null }
        return responder(chatId, 'grupo', MENSAJES.grupo())
    }

    const leido = leerComando(mensaje.text)
    switch (leido?.comando) {
        case 'start': {
            if (!leido.argumento) return responder(chatId, 'start', MENSAJES.bienvenida())
            try {
                const canje = await new CanjearCodigoTelegram().execute(
                    { token_vinculacion: leido.argumento, chat_id: chatId },
                    ctx,
                )
                return responder(chatId, 'vincular', MENSAJES.vinculado(canje.nombre))
            } catch (error) {
                if (error instanceof CodigoTelegramInvalido) {
                    return responder(chatId, 'vincular', MENSAJES.codigoInvalido())
                }
                throw error
            }
        }
        case 'estado': {
            let cuentas: CuentaChat[]
            try {
                cuentas = await cuentasDelChat(chatId)
            } catch (error) {
                logger.error(
                    { err: error, request_id: ctx.requestId },
                    'Telegram /estado: no se pudo leer la cuenta',
                )
                return responder(chatId, 'estado', MENSAJES.errorTemporal())
            }
            if (cuentas.length === 0) return responder(chatId, 'estado', MENSAJES.noVinculado())
            return responder(chatId, 'estado', textoEstado(cuentas))
        }
        case 'desvincular': {
            const cuentas = await cuentasDelChat(chatId).catch(() => null)
            if (cuentas === null) return responder(chatId, 'desvincular', MENSAJES.errorTemporal())
            if (cuentas.length === 0) return responder(chatId, 'desvincular', MENSAJES.noVinculado())
            for (const cuenta of cuentas) {
                // Misma transacción: desvincular y anular sus códigos pendientes (un enlace viejo
                // no debe volver a vincular el chat).
                await db.transaction(async (trx) => {
                    await new DesvincularTelegramCliente().execute({ id: cuenta.cliente_id }, ctx, { trx })
                    await new AnularCodigosTelegram().execute({ cliente_id: cuenta.cliente_id }, ctx, { trx })
                })
            }
            return responder(chatId, 'desvincular', MENSAJES.desvinculado())
        }
        default:
            return responder(chatId, 'ayuda', MENSAJES.ayuda())
    }
}

/**
 * Responde por el canal `telegram`. Si la Bot API falla no se relanza: la actualización ya se
 * procesó (un reintento del webhook repetiría el comando) y el error queda en el log.
 */
async function responder(chatId: string, comando: Comando, texto: string): Promise<ResultadoBot> {
    const canal = obtenerCanal('telegram')
    if (!canal) {
        logger.warn({ comando }, 'Telegram: no hay canal configurado para responder')
        return { comando, respuesta: texto }
    }
    try {
        await canal.enviar(chatId, null, texto)
    } catch (error) {
        logger.warn({ err: error, comando }, 'Telegram: no se pudo responder al chat')
    }
    return { comando, respuesta: texto }
}

/** Para el webhook: errores de negocio que no deben convertirse en 500 (Telegram reintentaría). */
export function esErrorDeNegocio(error: unknown): boolean {
    return error instanceof Problema && error.status < 500
}
