import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { routersConServiciosSinPppoe } from '#network/routeros/consultas'
import type { OpcionesDispatcher } from '#network/routeros/dispatcher'

/** Eventos de servicio: se recalcula el estado deseado completo del servicio. */
const EVENTOS_SERVICIO = new Set([
    'servicio.creado',
    'servicio.estado_cambiado',
    'servicio.config_cambiada',
    'asignacion.cambiada',
])

/**
 * Grupo `routeros` del bus (`contratos/eventos.md`): dispatcher de servicios sin PPPoE.
 *
 * - `servicio.*` y `asignacion.cambiada` → `AplicarRedServicio` del `servicio_id` (idempotente:
 *   el estado deseado sale de Postgres, así que un evento repetido o atrasado aplica lo vigente).
 * - `plan.velocidad_cambiada` → reconciliar los routers con servicios sin PPPoE de ese plan (o el
 *   router de la excepción).
 * - Un router caído no hace lanzar: la acción emite `routeros.fallido` y el job `recuperar` lo
 *   repone. Solo un error de Postgres lanza (el evento se reintenta).
 */
export class ConsumidorRouterOS implements ConsumidorEventos {
    readonly nombre = 'routeros'
    readonly #opciones: OpcionesDispatcher

    constructor(opciones: OpcionesDispatcher = {}) {
        this.#opciones = opciones
    }

    acepta(evento: string): boolean {
        return EVENTOS_SERVICIO.has(evento) || evento === 'plan.velocidad_cambiada'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const ctx = contextoSistema('worker', evento.requestId || `evento-${evento.id}`)
        const opciones = this.#opciones
        if (EVENTOS_SERVICIO.has(evento.evento)) {
            const servicioId = Number(evento.payload.servicio_id)
            if (!Number.isInteger(servicioId) || servicioId <= 0) return
            await new AplicarRedServicio(opciones).execute(
                { servicio_id: servicioId, evento_id: String(evento.id), evento: evento.evento },
                ctx,
            )
            return
        }
        const planId = Number(evento.payload.plan_id)
        const routerId = evento.payload.router_id === null ? null : Number(evento.payload.router_id)
        const routers =
            routerId !== null && Number.isInteger(routerId)
                ? [routerId]
                : await routersConServiciosSinPppoe({ planId: Number.isInteger(planId) ? planId : undefined })
        for (const id of routers) {
            await new ReconciliarRouterOS(opciones).execute(
                { router_id: id, motivo: 'plan', evento_id: String(evento.id) },
                ctx,
            )
        }
    }
}
