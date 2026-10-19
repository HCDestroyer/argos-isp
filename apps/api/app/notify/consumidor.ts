import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import ProgramarNotificacion from '#notify/actions/programar_notificacion'
import type { ColaEnvios } from '#notify/cola'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { EVENTOS_LEALTAD_CLIENTE } from '#notify/lealtad'

// La interfaz del bus vive en `app/shared/eventos_bus.ts` (A1, tarea 10); se reexporta aquí
// para no romper los imports existentes.
export type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'

/** Eventos de negocio que pueden generar una notificación al cliente (si hay plantilla activa). */
export const EVENTOS_NOTIFICABLES = [
    'factura.emitida',
    'factura.vencida',
    'servicio.estado_cambiado',
    'pago.registrado',
    'promesa.creada',
    'promesa.cumplida',
    'promesa.incumplida',
    // lealtad (`lealtad.ts`): los demás `lealtad.*` no avisan al cliente (README, "Avisos de lealtad")
    ...EVENTOS_LEALTAD_CLIENTE,
] as const

/** Prefijos aceptados además de la lista (familias de eventos de A3). */
const PREFIJOS_NOTIFICABLES = ['promesa.', 'comprobante.']

/**
 * Consumidor de notify: por cada evento notificable programa el envío (acción
 * `ProgramarNotificacion`, idempotente por `outbox:<id>`) y encola en BullMQ lo que quedó
 * `encolado`. Si falla, lanza: el relay debe reintentar la entrega del evento.
 */
export class ConsumidorNotify implements ConsumidorEventos {
    readonly nombre = 'notify'

    constructor(private readonly cola: ColaEnvios) {}

    acepta(evento: string): boolean {
        return (
            (EVENTOS_NOTIFICABLES as readonly string[]).includes(evento) ||
            PREFIJOS_NOTIFICABLES.some((prefijo) => evento.startsWith(prefijo))
        )
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        const resultado = await new ProgramarNotificacion().execute(
            { origen: `outbox:${evento.id}`, evento: evento.evento, payload: evento.payload ?? {} },
            contextoSistema('worker', evento.requestId ?? `outbox-${evento.id}`),
        )
        await this.cola.encolar(resultado.encolar)
        if (resultado.envios.length > 0) {
            logger.debug(
                {
                    outboxId: evento.id,
                    evento: evento.evento,
                    envios: resultado.envios.map((e) => e.id),
                    requestId: evento.requestId ?? null,
                },
                'Notificación programada',
            )
        }
    }
}
