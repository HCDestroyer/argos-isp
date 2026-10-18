import logger from '@adonisjs/core/services/logger'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { invalidarConfigHorus, publicarInvalidacionHorus } from '#integraciones/horus/configuracion'
import { EVENTOS_A_HORUS, registrarEnvio } from '#integraciones/horus/envios'

export const GRUPO_HORUS = 'horus'
export const EVENTO_CONFIG_HORUS = 'horus.config_cambiada'

/**
 * Consumidor del grupo `horus` sobre `argos:eventos` (`node ace horus:worker`).
 *
 * - `horus.config_cambiada`: descarta la configuración del conector y avisa a los demás procesos
 *   (regla 5, sin TTL).
 * - Eventos de §2.3 (`EVENTOS_A_HORUS`): registra el webhook hacia Horus si el conector está
 *   activo. Idempotente por id del outbox. Nunca cambia datos de Argos.
 */
export class ConsumidorHorus implements ConsumidorEventos {
    readonly nombre = 'horus'

    acepta(evento: string): boolean {
        return evento === EVENTO_CONFIG_HORUS || (EVENTOS_A_HORUS as readonly string[]).includes(evento)
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (evento.evento === EVENTO_CONFIG_HORUS) {
            invalidarConfigHorus()
            await publicarInvalidacionHorus()
            logger.info({ outboxId: evento.id }, 'horus: configuración del conector recargada')
            return
        }
        if (!this.acepta(evento.evento)) return
        await registrarEnvio(evento)
    }
}
