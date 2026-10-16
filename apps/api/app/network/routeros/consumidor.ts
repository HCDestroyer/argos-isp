import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { routersConServiciosSinPppoe } from '#network/routeros/consultas'
import type { OpcionesDispatcher } from '#network/routeros/dispatcher'
import { encolarPrefijo } from '#network/routeros/prefijos'
import { encolarCambioControl } from '#network/routeros/jobs'
import type { EntradaCambioControl } from '#network/routeros/cambio_control'
import type { ControlVelocidad } from '#network/velocidad'

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
 * - `sesion.iniciada` sin prefijo delegado → job `routeros-prefijos` (`CompletarPrefijoDelegado`, modo
 *   `radius_pool`: lee del router el /56 que delegó).
 * - `sesion.iniciada` / `sesion.terminada` → `AplicarRedServicio` del servicio: en un router que
 *   necesita control de velocidad (padre por plan o árbol) recalcula los objetos del plan; si no, no
 *   toca el router.
 * - `plan.velocidad_cambiada` → reconciliar los routers con servicios sin PPPoE de ese plan (o el
 *   router de la excepción).
 * - `router.control_cambiado` con cambio de modo → job `cambiar_control` (por lotes, `cambio_control.ts`);
 *   si solo cambió la capacidad → reconciliar el router (padres globales del árbol).
 * - Un router caído no hace lanzar: la acción emite `routeros.fallido` y el job `recuperar` lo
 *   repone. Solo un error de Postgres lanza (el evento se reintenta).
 */
export class ConsumidorRouterOS implements ConsumidorEventos {
    readonly nombre = 'routeros'
    readonly #opciones: OpcionesDispatcher
    readonly #cambioControl: (entrada: EntradaCambioControl) => Promise<unknown>

    /**
     * `cambioControl`: qué hacer con un cambio de modo (por defecto, encolarlo en `routeros-cron`;
     * las pruebas lo ejecutan en línea).
     */
    constructor(
        opciones: OpcionesDispatcher = {},
        cambioControl: (entrada: EntradaCambioControl) => Promise<unknown> = encolarCambioControl,
    ) {
        this.#opciones = opciones
        this.#cambioControl = cambioControl
    }

    acepta(evento: string): boolean {
        return (
            EVENTOS_SERVICIO.has(evento) ||
            evento === 'plan.velocidad_cambiada' ||
            evento === 'sesion.iniciada' ||
            evento === 'sesion.terminada' ||
            evento === 'router.control_cambiado'
        )
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
        if (evento.evento === 'sesion.iniciada') {
            // Sin /56 en el accounting (modo radius_pool): se pregunta al router en unos segundos.
            const { nas_ip: nasIp, acct_session_id: acct, prefijos_v6: prefijos } = evento.payload
            if (
                typeof nasIp === 'string' &&
                typeof acct === 'string' &&
                evento.payload.servicio_id !== null &&
                (!Array.isArray(prefijos) || prefijos.length < 2)
            ) {
                await encolarPrefijo({ nas_ip: nasIp, acct_session_id: acct })
            }
        }
        if (evento.evento === 'sesion.iniciada' || evento.evento === 'sesion.terminada') {
            // Colas dinámicas de PPPoE bajo el padre del plan (target del padre en modo simple).
            const servicioId = Number(evento.payload.servicio_id)
            if (!Number.isInteger(servicioId) || servicioId <= 0) return
            await new AplicarRedServicio(opciones).execute(
                { servicio_id: servicioId, evento_id: String(evento.id), evento: evento.evento },
                ctx,
            )
            return
        }
        if (evento.evento === 'router.control_cambiado') {
            const routerId = Number(evento.payload.router_id)
            if (!Number.isInteger(routerId) || routerId <= 0) return
            const modo = (v: unknown): ControlVelocidad => (v === 'arbol_pcq' ? 'arbol_pcq' : 'simple')
            const de = modo(evento.payload.de)
            const a = modo(evento.payload.a)
            if (de !== a) {
                await this.#cambioControl({
                    router_id: routerId,
                    de,
                    a,
                    evento_id: String(evento.id),
                    request_id: ctx.requestId,
                })
                return
            }
            // Solo cambió la capacidad del enlace: ajustar los padres globales.
            await new ReconciliarRouterOS(opciones).execute(
                { router_id: routerId, motivo: 'control', evento_id: String(evento.id) },
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
