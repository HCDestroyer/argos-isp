import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import DesconectarServicioEliminado from '#network/sesiones/actions/desconectar_servicio_eliminado'
import { sesionesAbiertasDeEliminado, userPppDeEliminado } from '#network/sesiones/desconexion'

/** Grupo del bus para las sesiones (`node ace sesiones:worker`). */
export const GRUPO_SESIONES = 'sesiones'

/**
 * Grupo `sesiones` del bus (A2): reacciones de `network.sesiones` a hechos de otros módulos.
 *
 * - `servicio.eliminado` (`contratos/eliminar.md`): si quedó una sesión viva del `user_ppp` que tenía
 *   el servicio, `DesconectarServicioEliminado` pide el Disconnect (`sesion.desconexion_solicitada`).
 *   Lo normal es que no haya ninguna (sin historial = nunca conectó): entonces no se ejecuta la
 *   acción y no queda fila de auditoría (no pasó nada). La autorización en caché la invalida
 *   `services/aaa` (`bajas.ts`) con el mismo evento.
 *
 * Idempotente: la consulta sale de Postgres; un evento repetido con la sesión ya cerrada no hace
 * nada. No busca el servicio (ya no existe). Si Postgres falla, lanza y el evento se reintenta.
 */
export class ConsumidorSesiones implements ConsumidorEventos {
    readonly nombre = GRUPO_SESIONES

    acepta(evento: string): boolean {
        return evento === 'servicio.eliminado'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const servicioId = Number(evento.payload.servicio_id)
        if (!Number.isInteger(servicioId) || servicioId <= 0) return
        const userPpp = await userPppDeEliminado(servicioId, evento.payload)
        if (!userPpp) return
        const abiertas = await sesionesAbiertasDeEliminado(userPpp)
        if (abiertas.length === 0) return
        await new DesconectarServicioEliminado().execute(
            { servicio_id: servicioId, user_ppp: userPpp, evento_id: String(evento.id) },
            contextoSistema('worker', evento.requestId || `evento-${evento.id}`),
        )
    }
}
