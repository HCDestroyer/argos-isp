import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import RevisarComodatos from '#inventario/actions/revisar_comodatos'

/**
 * Grupo `inventario` del bus (`contratos/inventario.md` §5, fase B): `servicio.estado_cambiado` →
 * `inventario.revisar_comodatos` (retirado: sus equipos en comodato quedan por recuperar; vuelve a
 * otro estado: vuelven a comodato). Idempotente: decide con el estado actual del servicio. Lo corre
 * `node ace billing:worker`.
 */
export class ConsumidorInventario implements ConsumidorEventos {
    readonly nombre = 'inventario'

    acepta(evento: string): boolean {
        return evento === 'servicio.estado_cambiado'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        const servicioId = Number(evento.payload.servicio_id)
        if (!Number.isInteger(servicioId) || servicioId <= 0) return
        // solo importa la entrada o la salida de retirado
        if (evento.payload.a !== 'retirado' && evento.payload.de !== 'retirado') return
        await new RevisarComodatos().execute(
            { servicio_id: servicioId },
            contextoSistema('worker', evento.requestId || `inventario-evento-${evento.id}`),
        )
    }
}
