import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { EVENTOS_A_IRIS, registrarEnvioIris } from '#integraciones/iris/envios'

export const GRUPO_IRIS = 'iris'

/**
 * Consumidor del grupo `iris` sobre `argos:eventos` (`node ace iris:worker`, A6): por cada evento
 * de §2.3 (`EVENTOS_A_IRIS`) registra el webhook hacia Iris si el conector tiene destino y el
 * evento es de una empresa de su alcance. Idempotente por id del outbox. Nunca cambia datos de
 * Argos. La configuración del conector se lee de la base en cada uso (A1): no hay caché que
 * invalidar.
 */
export class ConsumidorIris implements ConsumidorEventos {
    readonly nombre = 'iris'

    acepta(evento: string): boolean {
        return (EVENTOS_A_IRIS as readonly string[]).includes(evento)
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        await registrarEnvioIris(evento)
    }
}
