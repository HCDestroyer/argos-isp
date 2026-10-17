import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import RevisarPromesasCliente from '#billing/actions/revisar_promesas_cliente'

/**
 * Grupo `billing` del bus (contrato `contratos/eventos.md`): `pago.registrado` → cumplir las
 * promesas activas del pagador y de cada dueño de factura (`clientes`) con
 * `RevisarPromesasCliente`; `nota_credito.emitida` → lo mismo para el dueño de la factura (la nota
 * puede dejar el servicio sin deuda vencida y cumplir su promesa). Idempotente: repetir el evento no cambia nada. Lo corre
 * `node ace billing:worker`.
 */
export class ConsumidorBilling implements ConsumidorEventos {
    readonly nombre = 'billing'

    acepta(evento: string): boolean {
        return evento === 'pago.registrado' || evento === 'nota_credito.emitida'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        // pago de terceros: las promesas de cada dueño de factura (`clientes`), no solo del pagador
        const lista = Array.isArray(evento.payload.clientes) ? evento.payload.clientes : []
        const ids = [...new Set([evento.payload.cliente_id, ...lista].map(Number))].filter(
            (id) => Number.isInteger(id) && id > 0,
        )
        const ctx = contextoSistema('worker', evento.requestId || `evento-${evento.id}`)
        for (const clienteId of ids) {
            await new RevisarPromesasCliente().execute({ cliente_id: clienteId }, ctx)
        }
    }
}
