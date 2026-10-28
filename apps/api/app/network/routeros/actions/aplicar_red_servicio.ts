import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import { estadoDeseado, estadoVacio, type EstadoDeseado } from '#network/routeros/estado_deseado'
import {
    necesitaVelocidad,
    planesDeRouter,
    routerDispatcher,
    routersConHistorial,
    servicioRed,
    serviciosVigentesDeRouter,
} from '#network/routeros/consultas'
import { estadoVelocidadRouter } from '#network/routeros/velocidad_router'
import {
    aplicarEstado,
    asegurarVelocidad,
    enTransicion,
    leerVelocidadRouter,
    limpiarVelocidad,
    fabricaPorDefecto,
    LOCK_ROUTEROS,
    marcarPendiente,
    perfilSuspendido,
    registrarFallo,
    reportarReglasOro,
    type Cambio,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export interface EntradaAplicarRed {
    servicio_id: number
    /** id del evento que lo disparó (va a `audit.red`) */
    evento_id?: string | null
    evento?: string | null
}

export interface ResultadoRouter {
    router_id: number
    /** `deseado`: el router actual del servicio; `limpieza`: uno anterior (cambio de router) */
    papel: 'deseado' | 'limpieza'
    cambios: Cambio[]
    avisos: string[]
    error: string | null
    /** Reglas de oro incumplidas (no se escribió el padre o el árbol; `routeros.fallido`) */
    errores_velocidad: string[]
}

export interface ResultadoAplicarRed {
    servicio_id: number
    routers: ResultadoRouter[]
}

/**
 * Dispatcher WISP (semana 2, `contratos/routeros.md`): con cada evento de un servicio calcula su
 * estado deseado completo con los datos vigentes y lo aplica en el router de forma idempotente
 * (`estado_deseado.ts`). Lo llama el consumidor `routeros` del bus de eventos; no decide estados.
 *
 * - Router actual: crea, corrige o borra la cola, la address-list `suspendidos`, el lease y el ARP.
 *   Un servicio `pppoe`, `retirado` o `pendiente_instalacion` no tiene nada (el pendiente, hasta que
 *   `servicio.estado_cambiado` con `motivo: instalacion` lo pasa a activo).
 * - Routers anteriores (donde `audit.red` dice que el dispatcher escribió): se limpian los objetos
 *   del servicio (cambio de router o de tipo de conexión).
 * - Cada escritura queda en `audit.red` en el acto (`bitacoraRed`).
 * - Si el router no responde tras los reintentos del cliente, o no tiene credenciales: emite
 *   `routeros.fallido` por outbox, marca el router como pendiente (lo repone el job `recuperar`
 *   del reconciliador cuando vuelva) y **no lanza**: reintentar el evento no arregla un router caído.
 * - Serializa por router con `pg_advisory_xact_lock` (el reconciliador toma el mismo).
 * - Auditoría: solo cuando hubo cambios o errores. Un evento de un servicio PPPoE (la mayoría) no
 *   toca el router ni deja fila: es una evaluación sin efecto (regla 9; pedido al Líder BE en
 *   `.claude/integration/a2.md`).
 */
export default class AplicarRedServicio extends DomainAction<EntradaAplicarRed, ResultadoAplicarRed> {
    readonly nombre = 'routeros.aplicar_servicio'
    readonly #fabrica: FabricaClientes
    readonly #red: OpcionesDispatcher['red']

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#fabrica = opciones.clientes ?? fabricaPorDefecto
        this.#red = opciones.red
    }

    protected auditarExito(salida: ResultadoAplicarRed): boolean {
        return salida.routers.some(
            (r) => r.cambios.length > 0 || r.error !== null || r.errores_velocidad.length > 0,
        )
    }

    protected async handle(input: EntradaAplicarRed, t: Transaccion): Promise<ResultadoAplicarRed> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await servicioRed(input.servicio_id, t.trx)
        const historial = await routersConHistorial(input.servicio_id, t.trx)

        const objetivos = new Map<number, 'deseado' | 'limpieza'>()
        if (servicio) objetivos.set(servicio.router_id, 'deseado')
        for (const routerId of historial) if (!objetivos.has(routerId)) objetivos.set(routerId, 'limpieza')

        const resultado: ResultadoAplicarRed = { servicio_id: input.servicio_id, routers: [] }
        for (const [routerId, papel] of [...objetivos].sort((a, b) => a[0] - b[0])) {
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ROUTEROS, routerId])
            const router = await routerDispatcher(routerId, t.trx, this.#red)
            const deseado = papel === 'deseado' && servicio !== null
            // Objetos propios del servicio: WISP en su router, o limpieza donde escribió antes.
            // (PPPoE en `arbol_pcq`: sus direcciones en la lista del plan).
            const porServicio =
                !deseado ||
                servicio.tipo_conexion !== 'pppoe' ||
                historial.includes(routerId) ||
                router?.red.control_velocidad === 'arbol_pcq'
            let estado: EstadoDeseado = estadoVacio(input.servicio_id)
            if (deseado && router) estado = estadoDeseado(servicio, router.red, perfilSuspendido())

            // Control de velocidad del router (padres por plan, perfiles PPP): se recalcula con cada
            // evento que cambia quién cuenta en un plan. Un router que no lo necesita solo se revisa
            // ante un cambio que pudo dejar padres sobrantes (plan, router o tipo; retiro).
            const servicios = router ? await serviciosVigentesDeRouter(routerId, t.trx) : []
            const planes = router ? planesDeRouter(router.velocidad, servicios) : []
            const conVelocidad =
                router !== null &&
                (necesitaVelocidad(router.velocidad, planes) ||
                    (router.con_credenciales &&
                        (papel === 'limpieza' ||
                            !input.evento ||
                            input.evento === 'servicio.config_cambiada' ||
                            servicio?.estado === 'retirado')))
            if (!porServicio && !conVelocidad) continue

            const fila: ResultadoRouter = {
                router_id: routerId,
                papel,
                cambios: [],
                avisos: estado.avisos,
                error: null,
                errores_velocidad: [],
            }
            resultado.routers.push(fila)
            if (!router) continue

            try {
                const cliente = this.#fabrica(router.api)
                const ctx = {
                    servicio_id: input.servicio_id,
                    evento_id: input.evento_id ?? null,
                    request_id: t.ctx.requestId,
                    motivo: input.evento ?? undefined,
                }
                // Los objetos del plan no son del servicio: van a `audit.red` sin servicio_id.
                const ctxPlan = { ...ctx, servicio_id: null }
                try {
                    if (conVelocidad) {
                        const lectura = await leerVelocidadRouter(cliente)
                        const velocidad = estadoVelocidadRouter(router.velocidad, planes, lectura)
                        fila.avisos = [...fila.avisos, ...velocidad.avisos]
                        fila.errores_velocidad = await reportarReglasOro(
                            t,
                            {
                                router_id: routerId,
                                servicio_id: input.servicio_id,
                                evento_id: input.evento_id ?? null,
                            },
                            velocidad,
                        )
                        fila.cambios.push(...(await asegurarVelocidad(cliente, velocidad, lectura, ctxPlan)))
                        if (porServicio) fila.cambios.push(...(await aplicarEstado(cliente, estado, ctx)))
                        // Durante un cambio de modo, lo del modo anterior lo borra el cambio al final.
                        if (!(await enTransicion(routerId))) {
                            const despues = await leerVelocidadRouter(cliente)
                            fila.cambios.push(
                                ...(await limpiarVelocidad(cliente, velocidad, despues, ctxPlan)),
                            )
                        }
                    } else {
                        fila.cambios = await aplicarEstado(cliente, estado, ctx)
                    }
                } finally {
                    cliente.cerrar()
                }
            } catch (error) {
                if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) {
                    throw error
                }
                fila.error = error.message
                await registrarFallo({
                    router_id: routerId,
                    servicio_id: input.servicio_id,
                    operacion: 'aplicar',
                    evento_id: input.evento_id ?? null,
                    request_id: t.ctx.requestId,
                    error,
                })
                await t.emit('routeros.fallido', {
                    servicio_id: input.servicio_id,
                    router_id: routerId,
                    // legible para la alerta de A6: `queue/simple add`, `ip/arp remove`…
                    operacion:
                        error instanceof ErrorRouterOS && error.operacion
                            ? error.operacion
                            : 'credenciales del router',
                    error: error.message,
                })
                t.alConfirmar(() => marcarPendiente(routerId))
                logger.warn(
                    { servicio_id: input.servicio_id, router_id: routerId, err: error },
                    'routeros.fallido',
                )
            }
        }
        return resultado
    }
}
