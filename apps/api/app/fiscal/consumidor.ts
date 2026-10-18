import logger from '@adonisjs/core/services/logger'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { invalidarParametros } from '#fiscal/cache_parametros'

/**
 * Consumidor de `fiscal.parametros_cambiados` (grupo `billing`, en `node ace billing:worker`):
 * descarta la caché de parámetros de la empresa (null = todas) y vuelve a avisar a los demás
 * procesos por Pub/Sub, por si el aviso de la acción se perdió (regla 5). Idempotente: invalidar
 * dos veces no cambia nada.
 */
export class ConsumidorFiscal implements ConsumidorEventos {
    readonly nombre = 'fiscal-parametros'

    acepta(evento: string): boolean {
        return evento === 'fiscal.parametros_cambiados'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        const empresaId = typeof evento.payload.empresa_id === 'number' ? evento.payload.empresa_id : null
        await invalidarParametros(empresaId)
        logger.info(
            { outboxId: evento.id, empresa_id: empresaId, claves: evento.payload.claves ?? [] },
            'fiscal: caché de parámetros invalidada',
        )
    }
}
