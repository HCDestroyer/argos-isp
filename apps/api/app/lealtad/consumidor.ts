import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import { empresaConPrograma } from '#lealtad/programas'
import { referidoDeCliente } from '#core/referidos'
import EvaluarEventoLealtad, { EVENTOS_LEALTAD } from '#lealtad/actions/evaluar_evento'

/**
 * Consumidor del grupo `lealtad` del bus (contrato `contratos/lealtad.md` §13), corre en
 * `node ace billing:worker`. No decide nada: llama `lealtad.evaluar_evento` (regla 1), que es
 * idempotente por `clave_unica` (un evento repetido no da puntos dos veces). Una empresa sin
 * programa no se evalúa (con el programa apagado, nada cambia), salvo el `servicio.creado` de un
 * cliente referido: el referido se registra aunque la empresa aún no tenga programa.
 */
export class ConsumidorLealtad implements ConsumidorEventos {
    readonly nombre = 'lealtad'

    acepta(evento: string): boolean {
        return (EVENTOS_LEALTAD as readonly string[]).includes(evento)
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const empresaId = Number(evento.payload.empresa_id)
        if (!Number.isSafeInteger(empresaId) || empresaId <= 0) return
        if (!(await this.interesa(evento, empresaId))) return
        await new EvaluarEventoLealtad().execute(
            { evento: evento.evento, evento_id: evento.id, payload: evento.payload },
            contextoSistema('worker', evento.requestId || `evento-${evento.id}`),
        )
    }

    /** Empresa con programa; o, en `servicio.creado`, un cliente que llegó referido a esa empresa. */
    private async interesa(evento: EventoEntrante, empresaId: number): Promise<boolean> {
        if (await empresaConPrograma(empresaId)) return true
        if (evento.evento !== 'servicio.creado') return false
        const clienteId = Number(evento.payload.cliente_id)
        if (!Number.isSafeInteger(clienteId) || clienteId <= 0) return false
        const referido = await referidoDeCliente(clienteId)
        return referido?.referido_empresa_id === empresaId
    }
}
