import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { contextoSistema } from '#shared/contexto'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import DesconectarSesionLocal from '#network/routeros/actions/desconectar_sesion_local'
import type { OpcionesDispatcher } from '#network/routeros/dispatcher'
import { encolarPrefijo } from '#network/routeros/prefijos'
import { encolarCambioControl } from '#network/routeros/jobs'
import type { EntradaCambioControl } from '#network/routeros/cambio_control'
import type { ControlVelocidad } from '#network/velocidad'
import { routerDispatcher, firmaDeEvento } from '#network/routeros/consultas'
import { controlDerivado, leerEstrategias } from '#network/estrategia_velocidad'
import { sincronizarPlan } from '#network/routeros/sincronizar'

/** Eventos de servicio: se recalcula el estado deseado completo del servicio. */
const EVENTOS_SERVICIO = new Set([
    'servicio.creado',
    'servicio.estado_cambiado',
    'servicio.config_cambiada',
    'servicio.eliminado',
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
 * - `plan.velocidad_cambiada` → `sincronizarPlan` (`contratos/control-velocidad.md` §5): CoA de
 *   velocidad a las sesiones vivas del plan, `aaa:user:*` y reconciliar sus routers (o el de la excepción).
 * - `router.estrategia_cambiada` → job `cambiar_control` (por lotes, sin cortar; con `reconectar`,
 *   Disconnect por lotes como el cambio de modo de antes).
 * - `qos.config_cambiada` → reconciliar cada router de `routers[]` (clasificación, cadenas y hojas de
 *   QoS por clases, `contratos/qos.md`).
 * - `router.conexion_registrada` (A1, el router se conectó por primera vez) → reconciliar el router: deja
 *   el corte y la estrategia sin esperar al ciclo periódico.
 * - `router.control_cambiado` con cambio de modo → job `cambiar_control` (por lotes, `cambio_control.ts`);
 *   si solo cambió la capacidad → reconciliar el router (padres globales del árbol).
 * - PPPoE sin RADIUS (`contratos/pppoe-local.md`): los `servicio.*` (también `servicio.eliminado`)
 *   aplican el secret; `sesion.desconexion_solicitada` con `origen: 'sondeo'` → `DesconectarSesionLocal`
 *   (`/ppp active remove`; las de accounting son de `coa`); `router.radius_cambiado` con
 *   `modo_seguridad` en `campos` → reconciliar el router (crea o borra los secrets).
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
            evento === 'router.control_cambiado' ||
            evento === 'router.estrategia_cambiada' ||
            evento === 'qos.config_cambiada' ||
            evento === 'router.conexion_registrada' ||
            evento === 'router.radius_cambiado' ||
            evento === 'sesion.desconexion_solicitada'
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
        if (evento.evento === 'sesion.desconexion_solicitada') {
            // Solo las de sondeo (router sin RADIUS): las de accounting son de `coa`.
            const sesionId = Number(evento.payload.sesion_id)
            if (evento.payload.origen !== 'sondeo' || !Number.isInteger(sesionId) || sesionId <= 0) return
            await new DesconectarSesionLocal(opciones).execute(
                {
                    sesion_id: sesionId,
                    motivo: typeof evento.payload.motivo === 'string' ? evento.payload.motivo : null,
                    evento_id: String(evento.id),
                },
                ctx,
            )
            return
        }
        if (evento.evento === 'router.radius_cambiado') {
            // Cambio de modo (`radius` ↔ `api`): secrets, perfiles y corte del router en el modo nuevo.
            const routerId = Number(evento.payload.router_id)
            const campos = Array.isArray(evento.payload.campos) ? evento.payload.campos : []
            if (!campos.includes('modo_seguridad') || !Number.isInteger(routerId) || routerId <= 0) return
            await new ReconciliarRouterOS(opciones).execute(
                { router_id: routerId, motivo: 'control', evento_id: String(evento.id) },
                ctx,
            )
            return
        }
        if (evento.evento === 'sesion.iniciada') {
            // Sin /56 en el accounting (modo radius_pool): se pregunta al router en unos segundos.
            // Las de sondeo ya traen el del binding (o lo completa el siguiente sondeo).
            const { nas_ip: nasIp, acct_session_id: acct, prefijos_v6: prefijos } = evento.payload
            if (
                evento.payload.origen !== 'sondeo' &&
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
        if (evento.evento === 'router.estrategia_cambiada') {
            const routerId = Number(evento.payload.router_id)
            if (!Number.isInteger(routerId) || routerId <= 0) return
            const planId = evento.payload.plan_id === null ? null : Number(evento.payload.plan_id)
            const router = await routerDispatcher(routerId)
            if (!router) return
            const de =
                planId === null
                    ? controlDerivado(leerEstrategias(evento.payload.de))
                    : router.velocidad.control
            await this.#cambioControl({
                router_id: routerId,
                de,
                a:
                    planId === null
                        ? controlDerivado(leerEstrategias(evento.payload.a))
                        : router.velocidad.control,
                evento_id: String(evento.id),
                request_id: ctx.requestId,
                firma: firmaDeEvento(planId, evento.payload.a),
                plan_id: planId,
                reconectar: evento.payload.reconectar === true,
            })
            return
        }
        if (evento.evento === 'qos.config_cambiada') {
            // QoS por clases (contratos/qos.md §4): reconciliar los routers que usan el perfil. Sin CoA.
            const routers = Array.isArray(evento.payload.routers) ? evento.payload.routers : []
            for (const valor of routers) {
                const routerId = Number(valor)
                if (!Number.isInteger(routerId) || routerId <= 0) continue
                await new ReconciliarRouterOS(opciones).execute(
                    { router_id: routerId, motivo: 'qos', evento_id: String(evento.id) },
                    ctx,
                )
            }
            return
        }
        if (evento.evento === 'router.conexion_registrada') {
            const routerId = Number(evento.payload.router_id)
            if (!Number.isInteger(routerId) || routerId <= 0) return
            await new ReconciliarRouterOS(opciones).execute(
                { router_id: routerId, motivo: 'conexion', evento_id: String(evento.id) },
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
        // plan.velocidad_cambiada: lo mismo que «Sincronizar plan», con el actor sistema.
        const planId = Number(evento.payload.plan_id)
        if (!Number.isInteger(planId) || planId <= 0) return
        const routerId = evento.payload.router_id === null ? null : Number(evento.payload.router_id)
        await sincronizarPlan(
            {
                plan_id: planId,
                router_id: routerId !== null && Number.isInteger(routerId) ? routerId : null,
                evento_id: String(evento.id),
            },
            ctx,
            opciones,
        )
    }
}
