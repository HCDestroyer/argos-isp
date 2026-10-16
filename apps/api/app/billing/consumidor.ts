import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import RevisarPromesasCliente from '#billing/actions/revisar_promesas_cliente'

/**
 * Grupo `billing` del bus (contrato `contratos/eventos.md`): `pago.registrado` → cumplir las
 * promesas activas del cliente (`RevisarPromesasCliente`). Idempotente: repetir el evento no
 * cambia nada. Lo corre `node ace billing:worker`.
 */
export class ConsumidorBilling implements ConsumidorEventos {
    readonly nombre = 'billing'

    acepta(evento: string): boolean {
        return evento === 'pago.registrado'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const clienteId = Number(evento.payload.cliente_id)
        if (!Number.isInteger(clienteId) || clienteId <= 0) return
        const ctx = contextoSistema('worker', evento.requestId || `evento-${evento.id}`)
        await new RevisarPromesasCliente().execute({ cliente_id: clienteId }, ctx)
    }
}
