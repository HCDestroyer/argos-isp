import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DateTime } from 'luxon'
import { bloquearOrigen } from '#notify/envios'

/**
 * Avisos de soporte al cliente (contrato Iris 0.9.0 §6.6, A30 y A31). Iris manda los webhooks
 * `ticket.estado_cambiado`, `ticket.respondido` y `solicitud_servicio.estado_cambiado`; el receptor
 * de A1 (`RecibirWebhookIris`) los deduplica por `X-Webhook-Id` y los reemite al bus como
 * `soporte.*`. Aquí se decide qué plantilla avisa:
 *
 * - `soporte.ticket_estado_cambiado` con `a = resuelto` → `soporte.ticket_resuelto` («revisa y
 *   confirma» si `puede_confirmar`); con `a = cerrado` → `soporte.ticket_cerrado`. Los demás
 *   estados no avisan (el portal los muestra al abrirlo).
 * - `soporte.ticket_respondido` → `soporte.ticket_respondido`. Con `aviso_por_correo` Iris ya mandó
 *   el correo: no sale por correo, ni como respaldo de otro canal que falle. Con `masivo` (respuesta
 *   de una falla general a muchos tickets) un solo aviso por cliente en `VENTANA_MASIVO_MIN`: el
 *   primero avisa y los demás de esa ventana no (origen propio `soporte:masivo:<cliente>:<outbox>`).
 * - `soporte.solicitud_estado_cambiado` → `soporte.solicitud_estado_cambiado` con el estado nuevo
 *   (`estado_cliente` de §11.7) en palabras.
 *
 * Nunca el texto de un mensaje ni un motivo escrito por una persona: no vienen en el webhook y las
 * plantillas solo usan el número (`TK-…`, `PR-…`), el tipo y el estado. `origen` del ticket (canal
 * por el que se abrió) no es la marca `origen: iris` de §7 (lo que nace en Iris no se avisa): se
 * renombra a `ticket_origen` para no confundirlo.
 *
 * Idempotente como cualquier evento: `outbox:<id>` + cliente (y `webhook_id` ya deduplicado por A1).
 */

export const EVENTOS_SOPORTE = [
    'soporte.ticket_estado_cambiado',
    'soporte.ticket_respondido',
    'soporte.solicitud_estado_cambiado',
] as const

/** Plantillas de los avisos de soporte (correo y Telegram; WhatsApp lo maneja Iris en su conversación). */
export const PLANTILLAS_SOPORTE = [
    'soporte.ticket_resuelto',
    'soporte.ticket_cerrado',
    'soporte.ticket_respondido',
    'soporte.solicitud_estado_cambiado',
] as const

/** Un solo aviso por cliente de las respuestas masivas en esta ventana (minutos). */
export const VENTANA_MASIVO_MIN = 60

const TIPOS_SOLICITUD: Record<string, string> = {
    alta: 'servicio nuevo',
    cambio_plan: 'cambio de plan',
    traslado: 'traslado',
    otro: 'solicitud',
}

const ESTADOS_SOLICITUD: Record<string, string> = {
    recibida: 'la recibimos',
    en_revision: 'la estamos revisando',
    cotizada: 'ya tiene cotización',
    en_proceso: 'está en proceso',
    completada: 'quedó completada',
    no_procede: 'no procede',
}

export interface AvisoSoporte {
    /** plantilla (`soporte.ticket_resuelto`…) */
    evento: string
    payload: Record<string, unknown>
    /** Iris ya mandó el correo: sin correo ni respaldo por correo */
    sinCorreo: boolean
    /** respuesta masiva: un solo aviso por cliente en la ventana */
    masivo: boolean
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
}

/** Número para mostrar (`TK-000123`); sin él, el id de Iris. Sin saltos de línea ni largos raros. */
function numero(p: Record<string, unknown>, id: string): string {
    return (texto(p.numero) ?? texto(p[id]) ?? '').replace(/\s+/g, ' ').slice(0, 40)
}

export function esEventoSoporte(evento: string): boolean {
    return (EVENTOS_SOPORTE as readonly string[]).includes(evento)
}

/** Plantilla y payload del aviso, o null si ese cambio no se avisa al cliente. */
export function avisoDeSoporte(evento: string, p: Record<string, unknown>): AvisoSoporte | null {
    const { origen, ...resto } = p
    const base = { ...resto, ticket_origen: texto(origen) }
    if (evento === 'soporte.ticket_estado_cambiado') {
        const a = texto(p.a)
        if (a !== 'resuelto' && a !== 'cerrado') return null
        return {
            evento: a === 'resuelto' ? 'soporte.ticket_resuelto' : 'soporte.ticket_cerrado',
            payload: {
                ...base,
                ticket: {
                    id: texto(p.ticket_id),
                    numero: numero(p, 'ticket_id'),
                    puede_confirmar: a === 'resuelto' && p.puede_confirmar !== false,
                },
            },
            sinCorreo: false,
            masivo: false,
        }
    }
    if (evento === 'soporte.ticket_respondido') {
        return {
            evento: 'soporte.ticket_respondido',
            payload: {
                ...base,
                ticket: {
                    id: texto(p.ticket_id),
                    numero: numero(p, 'ticket_id'),
                    masivo: p.masivo === true,
                    de_sistema: p.autor_tipo === 'sistema',
                },
            },
            sinCorreo: p.aviso_por_correo === true,
            masivo: p.masivo === true,
        }
    }
    if (evento === 'soporte.solicitud_estado_cambiado') {
        const a = texto(p.a)
        if (!a) return null
        const tipo = texto(p.tipo)
        return {
            evento: 'soporte.solicitud_estado_cambiado',
            payload: {
                ...base,
                solicitud: {
                    id: texto(p.solicitud_id),
                    numero: numero(p, 'solicitud_id'),
                    tipo: tipo ?? '',
                    tipo_texto: (tipo && TIPOS_SOLICITUD[tipo]) || 'solicitud',
                    estado: a,
                    // un estado que Argos no conoce se dice sin inventarlo
                    estado_texto: ESTADOS_SOLICITUD[a] ?? 'cambió de estado',
                    completada: a === 'completada',
                    no_procede: a === 'no_procede',
                },
            },
            sinCorreo: false,
            masivo: false,
        }
    }
    return null
}

/**
 * Origen del aviso de una respuesta masiva: `soporte:masivo:<cliente>:<origen del evento>`, o null
 * si ese cliente ya tiene un aviso masivo programado en la ventana (no se avisa de nuevo). Bloquea
 * por cliente: dos tickets de la misma falla procesados a la vez no avisan dos veces. Una entrega
 * repetida del mismo evento encuentra su propio origen y devuelve los mismos envíos.
 */
export async function origenMasivo(
    trx: TransactionClientContract,
    origen: string,
    clienteId: number,
    ahora: DateTime,
): Promise<string | null> {
    const propio = `soporte:masivo:${clienteId}:${origen}`
    await bloquearOrigen(trx, `soporte:masivo:${clienteId}`)
    const reciente = (await trx
        .from('notify.envios')
        .where('cliente_id', clienteId)
        .where('evento', 'soporte.ticket_respondido')
        .where('origen', 'like', `soporte:masivo:${clienteId}:%`)
        .whereNot('origen', propio)
        .where('created_at', '>', ahora.minus({ minutes: VENTANA_MASIVO_MIN }).toJSDate())
        .select('id')
        .first()) as { id: number } | null
    return reciente ? null : propio
}
