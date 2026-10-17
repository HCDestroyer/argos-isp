import logger from '@adonisjs/core/services/logger'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { invalidarConfiguracion, publicarInvalidacion } from '#notify/configuracion'

export const EVENTO_CONFIG_CAMBIADA = 'notificaciones.config_cambiada'

/**
 * Consumidor de `notificaciones.config_cambiada` (grupo `notify`, en `node ace notify:worker`):
 * el worker descarta su configuración de canales y la vuelve a leer, sin reiniciarse (regla 5).
 * Como un grupo entrega cada evento a **un** proceso, además lo avisa por Redis Pub/Sub a los
 * demás (API, otras réplicas). Idempotente: recargar dos veces no cambia nada.
 */
export class ConsumidorConfigNotify implements ConsumidorEventos {
    readonly nombre = 'notify-config'

    acepta(evento: string): boolean {
        return evento === EVENTO_CONFIG_CAMBIADA
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        invalidarConfiguracion()
        await publicarInvalidacion()
        logger.info(
            {
                outboxId: evento.id,
                configuracion_id: evento.payload.configuracion_id ?? null,
                empresa_id: evento.payload.empresa_id ?? null,
                request_id: evento.requestId ?? null,
            },
            'notify: configuración de canales recargada',
        )
    }
}
