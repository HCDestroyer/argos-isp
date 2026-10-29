import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { ObjetoRouterOS } from '#network/routeros/cliente'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import {
    estadoDeseado,
    estadoVacio,
    RUTAS_SERVICIO,
    servicioDeComment,
    type RutaServicio,
} from '#network/routeros/estado_deseado'
import {
    estrategiasEnUso,
    necesitaVelocidad,
    planesDeRouter,
    redesV4DeRouter,
    routerDispatcher,
    serviciosVigentesDeRouter,
} from '#network/routeros/consultas'
import { configCorteResuelta, estadoCorteRouter } from '#network/routeros/corte_router'
import { estadoVelocidadRouter } from '#network/routeros/velocidad_router'
import { guardarLecturaColas } from '#network/routeros/metricas'
import {
    aplicarCorte,
    aplicarEstado,
    asegurarVelocidad,
    leerCorteRouter,
    pideFasttrack,
    enTransicion,
    fabricaPorDefecto,
    leerVelocidadRouter,
    limpiarVelocidad,
    LOCK_ROUTEROS,
    marcarPendiente,
    perfilSuspendido,
    registrarFallo,
    reportarReglasOro,
    quitarPendiente,
    type Cambio,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export interface EntradaReconciliar {
    router_id: number
    /** `periodico` (red de seguridad), `recuperado` (el router volvió), `plan` (cambió la velocidad), `manual` */
    motivo: 'periodico' | 'recuperado' | 'plan' | 'manual' | 'control' | 'conexion'
    evento_id?: string | null
}

export interface ResultadoReconciliar {
    router_id: number
    motivo: EntradaReconciliar['motivo']
    /** Servicios sin PPPoE vigentes en el router */
    servicios: number
    /** Lo que se corrigió: objetos faltantes o distintos (`creado`/`actualizado`) y huérfanos (`borrado`) */
    correcciones: Cambio[]
    avisos: string[]
    error: string | null
    /** El router no existe, está inactivo o sin servicios que reconciliar */
    omitido: boolean
    /** Colas simples del router en esta lectura (todas); null si no se pudo leer */
    colas_simples: number | null
    /** Reglas de oro incumplidas (no se escribió el padre o el árbol; `routeros.fallido`) */
    errores_velocidad: string[]
    /**
     * El portal es un nombre que no resolvió a IPv4: no se escribió el NAT de HTTP a `/corte` (la regla
     * que hubiera queda como está) y se emitió `routeros.fallido`. null si no hubo problema.
     */
    error_portal: string | null
}

/**
 * Reconciliador (semana 2, `contratos/routeros.md`): compara el router contra el estado deseado de
 * TODOS sus servicios sin PPPoE (por `comment = argosisp:servicio:<id>`) y corrige diferencias:
 * crea lo que falta (una cola borrada a mano), corrige lo que difiere y borra lo huérfano (objetos
 * de servicios retirados, pasados a PPPoE o movidos a otro router). No es una caché: el estado
 * deseado sale de Postgres cada vez (no aplica la regla 5).
 *
 * - Lee cada menú una vez (`listar`) y solo escribe lo que difiere; cada escritura va a `audit.red`.
 * - Si el router no responde: `routeros.fallido` (`servicio_id: null`), queda pendiente y no lanza.
 *   Al terminar bien lo quita de los pendientes.
 * - Mismo lock por router que `AplicarRedServicio`. El job periódico además corre con lock global.
 * - Auditoría solo cuando corrigió algo o falló (una pasada sin diferencias no es una acción de nadie).
 */
export default class ReconciliarRouterOS extends DomainAction<EntradaReconciliar, ResultadoReconciliar> {
    readonly nombre = 'routeros.reconciliar'
    readonly #fabrica: FabricaClientes
    readonly #red: OpcionesDispatcher['red']
    readonly #resolver: OpcionesDispatcher['resolver']

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#fabrica = opciones.clientes ?? fabricaPorDefecto
        this.#red = opciones.red
        this.#resolver = opciones.resolver
    }

    protected auditarExito(salida: ResultadoReconciliar): boolean {
        return (
            salida.correcciones.length > 0 ||
            salida.error !== null ||
            salida.errores_velocidad.length > 0 ||
            salida.error_portal !== null
        )
    }

    protected async handle(input: EntradaReconciliar, t: Transaccion): Promise<ResultadoReconciliar> {
        t.fijarEntidad('router', input.router_id)
        const salida: ResultadoReconciliar = {
            router_id: input.router_id,
            motivo: input.motivo,
            servicios: 0,
            correcciones: [],
            avisos: [],
            error: null,
            omitido: false,
            colas_simples: null,
            errores_velocidad: [],
            error_portal: null,
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ROUTEROS, input.router_id])
        const router = await routerDispatcher(input.router_id, t.trx, this.#red)
        if (!router || !router.activo) {
            salida.omitido = true
            t.alConfirmar(() => quitarPendiente(input.router_id))
            return salida
        }
        const todos = await serviciosVigentesDeRouter(input.router_id, t.trx)
        const servicios = todos.filter((s) => s.tipo_conexion !== 'pppoe')
        const planes = planesDeRouter(router.velocidad, todos)
        const conVelocidad = router.con_credenciales || necesitaVelocidad(router.velocidad, planes)
        salida.servicios = servicios.length
        const ctx = (servicioId: number) => ({
            servicio_id: servicioId,
            evento_id: input.evento_id ?? null,
            request_id: t.ctx.requestId,
            motivo: `reconciliar: ${input.motivo}`,
        })

        let nodosArbol: number | null = null
        try {
            const cliente = this.#fabrica(router.api)
            try {
                // Control de velocidad primero: los padres deben existir antes que sus hijas.
                const ctxPlan = {
                    servicio_id: null,
                    evento_id: input.evento_id ?? null,
                    request_id: t.ctx.requestId,
                    motivo: `reconciliar: ${input.motivo}`,
                }
                // Versión de RouterOS (CAKE y fq_codel necesitan la 7): se guarda si cambió.
                if (router.con_credenciales) {
                    const recurso = await cliente.probar()
                    const version = typeof recurso.version === 'string' ? recurso.version.slice(0, 100) : null
                    if (version && version !== router.velocidad.routeros_version) {
                        await t.trx
                            .from('network.routers')
                            .where('id', input.router_id)
                            .update({ routeros_version: version })
                        router.velocidad.routeros_version = version
                    }
                }
                // Corte y FastTrack (siempre, sea cual sea la estrategia): la lista de interfaces, el
                // perfil suspendido, las listas y las reglas, en orden (corte_router.ts).
                if (router.con_credenciales) {
                    const lecturaCorte = await leerCorteRouter(cliente)
                    // El FQDN del portal se resuelve en cada pasada (sin caché): si no resuelve, error
                    // visible y la regla de NAT que haya queda como está.
                    const config = await configCorteResuelta(process.env, this.#resolver)
                    if (config.portal_v4_error) {
                        salida.error_portal = config.portal_v4_error
                        await t.emit('routeros.fallido', {
                            servicio_id: null,
                            router_id: input.router_id,
                            operacion: 'resolver portal',
                            error: config.portal_v4_error,
                        })
                    }
                    const corte = estadoCorteRouter(
                        config,
                        {
                            fasttrack: pideFasttrack(estrategiasEnUso(router.velocidad, todos)),
                            redes_v4: await redesV4DeRouter(input.router_id, t.trx),
                        },
                        lecturaCorte.get('/ppp/profile') ?? [],
                    )
                    salida.avisos.push(...corte.avisos)
                    salida.correcciones.push(...(await aplicarCorte(cliente, corte, lecturaCorte, ctxPlan)))
                }
                const lecturaVelocidad = conVelocidad ? await leerVelocidadRouter(cliente) : null
                nodosArbol = lecturaVelocidad?.get('/queue/tree')?.length ?? null
                const velocidad = lecturaVelocidad
                    ? estadoVelocidadRouter(router.velocidad, planes, lecturaVelocidad)
                    : null
                if (velocidad && lecturaVelocidad) {
                    salida.avisos.push(...velocidad.avisos)
                    salida.errores_velocidad = await reportarReglasOro(
                        t,
                        { router_id: input.router_id, servicio_id: null, evento_id: input.evento_id ?? null },
                        velocidad,
                    )
                    salida.correcciones.push(
                        ...(await asegurarVelocidad(cliente, velocidad, lecturaVelocidad, ctxPlan)),
                    )
                }
                // Una lectura por menú: objetos con comment de servicio, agrupados por comment.
                const actuales = new Map<RutaServicio, Map<string, ObjetoRouterOS[]>>()
                const enRouter = new Set<number>()
                for (const ruta of RUTAS_SERVICIO) {
                    const porComment = new Map<string, ObjetoRouterOS[]>()
                    const objetos = await cliente.listar(ruta)
                    // Todas las colas simples (también las dinámicas de PPPoE): métrica de A6.
                    if (ruta === '/queue/simple') salida.colas_simples = objetos.length
                    for (const objeto of objetos) {
                        const id = servicioDeComment(objeto.comment)
                        if (id === null) continue
                        enRouter.add(id)
                        const lista = porComment.get(objeto.comment!) ?? []
                        lista.push(objeto)
                        porComment.set(objeto.comment!, lista)
                    }
                    actuales.set(ruta, porComment)
                }
                // Todos los vigentes (también PPPoE: sus entradas del árbol en `arbol_pcq`).
                const vigentes = new Set(todos.map((s) => s.servicio_id))
                for (const servicio of todos) {
                    const estado = estadoDeseado(servicio, router.red, perfilSuspendido())
                    salida.avisos.push(...estado.avisos.map((a) => `servicio ${servicio.servicio_id}: ${a}`))
                    salida.correcciones.push(
                        ...(await aplicarEstado(cliente, estado, ctx(servicio.servicio_id), actuales)),
                    )
                }
                // Huérfanos: objetos de servicios que ya no deben estar en este router.
                for (const id of [...enRouter].filter((s) => !vigentes.has(s)).sort((a, b) => a - b)) {
                    salida.correcciones.push(
                        ...(await aplicarEstado(cliente, estadoVacio(id), ctx(id), actuales)),
                    )
                }
                if (velocidad && !(await enTransicion(input.router_id))) {
                    const despues = await leerVelocidadRouter(cliente)
                    salida.correcciones.push(
                        ...(await limpiarVelocidad(cliente, velocidad, despues, ctxPlan)),
                    )
                }
            } finally {
                cliente.cerrar()
            }
            t.alConfirmar(() => quitarPendiente(input.router_id))
            const colas = salida.colas_simples
            if (colas !== null) {
                const arbol = nodosArbol
                t.alConfirmar(() =>
                    guardarLecturaColas(input.router_id, router.nombre, colas, {
                        arbol,
                        control: router.velocidad.control,
                    }),
                )
            }
        } catch (error) {
            if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
            salida.error = error.message
            await registrarFallo({
                router_id: input.router_id,
                servicio_id: null,
                operacion: 'reconciliar',
                evento_id: input.evento_id ?? null,
                request_id: t.ctx.requestId,
                error,
            })
            await t.emit('routeros.fallido', {
                servicio_id: null,
                router_id: input.router_id,
                operacion: 'reconciliar',
                error: error.message,
            })
            t.alConfirmar(() => marcarPendiente(input.router_id))
            logger.warn({ router_id: input.router_id, err: error }, 'routeros.fallido (reconciliar)')
        }
        return salida
    }
}
