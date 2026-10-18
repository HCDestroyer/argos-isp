import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import { empresaConPrograma } from '#lealtad/programas'
import EvaluarEventoLealtad, { EVENTOS_LEALTAD } from '#lealtad/actions/evaluar_evento'

/**
 * Consumidor del grupo `lealtad` del bus (contrato `contratos/lealtad.md` §13), corre en
 * `node ace billing:worker`. No decide nada: llama `lealtad.evaluar_evento` (regla 1), que es
 * idempotente por `clave_unica` (un evento repetido no da puntos dos veces). Una empresa sin
 * programa no se evalúa (con el programa apagado, nada cambia).
 */
export class ConsumidorLealtad implements ConsumidorEventos {
    readonly nombre = 'lealtad'

    acepta(evento: string): boolean {
        return (EVENTOS_LEALTAD as readonly string[]).includes(evento)
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const empresaId = Number(evento.payload.empresa_id)
        if (!Number.isSafeInteger(empresaId) || empresaId <= 0) return
        if (!(await empresaConPrograma(empresaId))) return
        await new EvaluarEventoLealtad().execute(
            { evento: evento.evento, evento_id: evento.id, payload: evento.payload },
            contextoSistema('worker', evento.requestId || `evento-${evento.id}`),
        )
    }
}
