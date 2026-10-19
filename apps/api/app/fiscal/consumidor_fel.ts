import logger from '@adonisjs/core/services/logger'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { avisosPorCertificar } from '#fiscal/fel/cola'

/**
 * Consumidor de `pago.registrado` y `pago.diferencia_cerrada` (grupo `billing`, en `node ace
 * billing:worker`): los avisos de cobro que el pago (o el cierre de su diferencia, decisión B) dejó
 * cubiertos piden su certificación al momento (contrato §8.3), sin esperar a la corrida de la cola `fel`. Idempotente: `fel.certificar` devuelve el DTE vigente si ya existe.
 */
export class ConsumidorFel implements ConsumidorEventos {
    readonly nombre = 'fiscal-fel'

    acepta(evento: string): boolean {
        return evento === 'pago.registrado' || evento === 'pago.diferencia_cerrada'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        const crudas = Array.isArray(evento.payload.facturas) ? (evento.payload.facturas as unknown[]) : []
        const facturas = crudas
            .map((f) =>
                Number(typeof f === 'object' && f !== null ? (f as { factura_id?: unknown }).factura_id : f),
            )
            .filter((id) => Number.isSafeInteger(id) && id > 0)
        if (facturas.length === 0) return
        const ctx = contextoSistema('worker', `fel-pago-${evento.id}`)
        for (const facturaId of await avisosPorCertificar(facturas.length, facturas)) {
            await new SolicitarCertificacion().execute({ factura_id: facturaId, automatico: true }, ctx)
        }
        logger.debug({ outboxId: evento.id, facturas }, 'fel: avisos cubiertos por el pago revisados')
    }
}
