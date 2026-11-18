import logger from '@adonisjs/core/services/logger'
import { configCorteVigente, corteUrlVigente } from '#network/routeros/corte_vigente'
import { cerrarCodigosCorte, sincronizarCodigoCorte } from '#portal/codigos_corte'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { ClienteRouterOS, ContextoRed, ObjetoRouterOS } from '#network/routeros/cliente'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import {
    estadoDeseado,
    estadoVacio,
    RUTAS_SERVICIO,
    servicioDeComment,
    type RutaServicio,
    type ServicioRed,
} from '#network/routeros/estado_deseado'
import {
    necesitaVelocidad,
    planesDeRouter,
    routerDispatcher,
    serviciosVigentesDeRouter,
    type RouterDispatcher,
} from '#network/routeros/consultas'
import {
    clientesUsanDnsRouter,
    estadoCorteRouter,
    MENSAJE_PROXY_DEVICE_MODE,
    revisarDnsRouter,
    urlCorteConCodigo,
} from '#network/routeros/corte_router'
import { estadoVelocidadRouter, gatewaysDeRedes } from '#network/routeros/velocidad_router'
import { aplicarRedAcceso } from '#network/routeros/aplicar_red_acceso'
import { redAccesoDeRouter } from '#network/routeros/consultas_red_acceso'
import { guardarLecturaColas } from '#network/routeros/metricas'
import { opcionesCorteRouter } from '#network/routeros/opciones_corte'
import { emitirRedesCambiadas } from '#network/conexion/tunel_corte'
import { reconciliarSecrets, sesionesQuitadas } from '#network/routeros/pppoe_local'
import { cerrarSesionesQuitadas } from '#network/sesiones/sesiones'
import {
    aplicarCorte,
    aplicarEstado,
    ordenarAccesoProxy,
    asegurarVelocidad,
    leerCorteRouter,
    enTransicion,
    esObjetoQos,
    registrarVerificacionQos,
    verificarQos,
    fabricaPorDefecto,
    intentarPaso,
    leerVelocidadRouter,
    proxyCorteBloqueado,
    limpiarVelocidad,
    LOCK_ROUTEROS,
    marcarPendiente,
    perfilSuspendido,
    registrarFallo,
    reportarReglasOro,
    quitarPendiente,
    type Cambio,
    type ErrorOperacion,
    type LecturaCorte,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export interface EntradaReconciliar {
    router_id: number
    /** `periodico` (red de seguridad), `recuperado` (el router volvió), `plan` (cambió la velocidad), `manual` */
    motivo:
        | 'periodico'
        | 'recuperado'
        | 'plan'
        | 'manual'
        | 'control'
        | 'conexion'
        | 'qos'
        | 'red_acceso'
        | 'portal'
        | 'corte_identificacion'
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
    /** Secrets PPPoE que el router rechazó (`contratos/pppoe-local.md` §2); cada uno con `routeros.fallido` */
    errores_secrets: string[]
    /**
     * Pasos que el router rechazó sin impedir lo demás (un comando con 400, p. ej. `invalid local port`), y
     * `proxy_corte` si el device-mode no permite el proxy web. Cada uno con `routeros.fallido`. Vacío si todo
     * salió bien. Si el router no responde, va en `error` (falla general).
     */
    errores: ErrorOperacion[]
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
            salida.error_portal !== null ||
            salida.errores_secrets.length > 0 ||
            salida.errores.length > 0
        )
    }

    /** `routeros.fallido` por cada paso rechazado (el comando ya está en `audit.red`). */
    async #reportar(t: Transaccion, routerId: number, errores: ErrorOperacion[]): Promise<void> {
        for (const e of errores) {
            await t.emit('routeros.fallido', {
                servicio_id: null,
                router_id: routerId,
                operacion: e.operacion,
                error: e.mensaje,
            })
        }
    }

    /** Corte y FastTrack del router: estado deseado, `aplicarCorte` (con `errores`) y revisión del DNS. */
    async #corte(
        t: Transaccion,
        input: EntradaReconciliar,
        salida: ResultadoReconciliar,
        d: {
            cliente: ClienteRouterOS
            router: RouterDispatcher
            todos: ServicioRed[]
            modoCodigo: boolean
            lectura: LecturaCorte
            ctx: ContextoRed
        },
    ): Promise<void> {
        // El FQDN del portal se resuelve en cada pasada (sin caché): si no resuelve, error
        // visible y la regla de NAT que haya queda como está.
        const config = await configCorteVigente(this.#resolver, t.trx)
        if (config.portal_v4_error) {
            salida.error_portal = config.portal_v4_error
            await t.emit('routeros.fallido', {
                servicio_id: null,
                router_id: input.router_id,
                operacion: 'resolver portal',
                error: config.portal_v4_error,
            })
        }
        const opcionesCorte = await opcionesCorteRouter(
            input.router_id,
            d.router,
            d.todos,
            d.modoCodigo,
            t.trx,
        )
        const corte = estadoCorteRouter(config, opcionesCorte, d.lectura.get('/ppp/profile') ?? [])
        salida.avisos.push(...corte.avisos)
        // Modo código, en este orden (`aplicarCorte`): el `drop` de input del 3346, el puerto en
        // `/ip proxy` sin encenderlo (RouterOS no acepta un `local-port` que no esté ahí), la regla
        // final y su orden, el NAT al 3346 y al final se enciende el proxy. Al volver a `ip`, al
        // revés: el NAT, las reglas del 3346, el puerto y por último el `drop` de input. Un comando
        // rechazado no detiene lo demás (lo que dependa de él se salta).
        const antes = salida.errores.length
        const hechosCorte = await aplicarCorte(d.cliente, corte, d.lectura, d.ctx, salida.errores)
        await this.#reportar(t, input.router_id, salida.errores.slice(antes))
        salida.correcciones.push(...hechosCorte)
        // Respaldo de `router.redes_cambiadas` (§5 ter.10 de contratos/corte-identificacion.md):
        // con el corte por el túnel, las redes de `argos-clientes` van también en AllowedIPs. Si
        // cambiaron aquí, el `wireguard-agente` vuelve a pedir los peers en la misma pasada.
        if (
            opcionesCorte.tunel &&
            hechosCorte.some(
                (h) => h.ruta === '/ip/firewall/address-list' && h.comment.startsWith('argos-clientes '),
            )
        ) {
            await emitirRedesCambiadas(t, [input.router_id])
        }
        // DNS del router: solo se revisa (es del operador). Mal = el suspendido no resuelve.
        let dnsRouter: Record<string, string> | null = null
        try {
            dnsRouter = await d.cliente.leerDns()
        } catch (error) {
            if (!(error instanceof ErrorRouterOS)) throw error
            salida.avisos.push(`no se pudo leer /ip dns: ${error.message}`)
        }
        const usaDns = clientesUsanDnsRouter(
            d.lectura.get('/ppp/profile') ?? [],
            gatewaysDeRedes(d.router.velocidad.redes_ipv4),
        )
        for (const p of dnsRouter ? revisarDnsRouter(dnsRouter, usaDns) : []) {
            salida.avisos.push(p.mensaje)
            await t.emit('routeros.fallido', {
                servicio_id: null,
                router_id: input.router_id,
                operacion: `dns del router (${p.codigo})`,
                error: p.mensaje,
            })
        }
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
            errores_secrets: [],
            errores: [],
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ROUTEROS, input.router_id])
        const router = await routerDispatcher(input.router_id, t.trx, this.#red)
        if (!router || !router.activo) {
            salida.omitido = true
            t.alConfirmar(() => quitarPendiente(input.router_id))
            return salida
        }
        const todos = await serviciosVigentesDeRouter(input.router_id, t.trx)
        // Corte por código (`contratos/corte-identificacion.md`): código de cada suspendido (los que se
        // suspendieron antes de pasar el router a `codigo` reciben el suyo aquí) y la URL de su regla.
        const modoCodigo = router.con_credenciales && router.red.corte_identificacion === 'codigo'
        const baseCorte = modoCodigo ? await corteUrlVigente(t.trx) : null
        await cerrarCodigosCorte(
            t,
            todos.filter((s) => s.estado !== 'suspendido').map((s) => s.servicio_id),
        )
        for (const servicio of todos.filter((s) => s.estado === 'suspendido')) {
            const c = await sincronizarCodigoCorte(
                t,
                { servicio_id: servicio.servicio_id, estado: servicio.estado, router_id: input.router_id },
                modoCodigo,
            )
            if (modoCodigo && c.codigo && baseCorte) {
                servicio.url_corte_codigo = urlCorteConCodigo(baseCorte, c.codigo)
            }
        }
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
            /**
             * Un paso que el router puede rechazar sin impedir lo demás: el rechazo (400) va a `errores` y
             * a `routeros.fallido` y se sigue. Si el router no responde o rechaza las credenciales, lanza
             * (falla general, más abajo).
             */
            const paso = async (operacion: string, fn: () => Promise<void>): Promise<boolean> => {
                const antes = salida.errores.length
                const ok = await intentarPaso(salida.errores, operacion, fn)
                await this.#reportar(t, input.router_id, salida.errores.slice(antes))
                return ok
            }
            try {
                // Control de velocidad primero: los padres deben existir antes que sus hijas.
                const ctxPlan = {
                    servicio_id: null,
                    evento_id: input.evento_id ?? null,
                    request_id: t.ctx.requestId,
                    motivo: `reconciliar: ${input.motivo}`,
                }
                // Versión de RouterOS (CAKE y fq_codel necesitan la 7): se guarda si cambió. Es también la
                // primera lectura: si el router no responde aquí, la reconciliación falla entera.
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
                // Red de acceso administrada (contratos/red-acceso.md §6.3): VLAN → perfil → servidor,
                // antes que lo demás; nunca lo adoptado ni lo ajeno.
                if (router.con_credenciales) {
                    await paso('red de acceso', async () => {
                        const acceso = await redAccesoDeRouter(input.router_id, t.trx)
                        if (
                            acceso.vlans.length > 0 ||
                            acceso.servidores.length > 0 ||
                            input.motivo === 'red_acceso'
                        ) {
                            const r = await aplicarRedAcceso(
                                cliente,
                                acceso.vlans,
                                acceso.servidores,
                                ctxPlan,
                            )
                            salida.correcciones.push(...r.cambios)
                            salida.avisos.push(...r.avisos)
                        }
                    })
                }
                // Corte por código con el proxy web bloqueado por el device-mode (RouterOS 7.17+, bug v1.17.0
                // del PM): ninguna regla de `/ip proxy access` entra (`invalid local port`). Mientras tanto
                // el router se corta como en modo ip (dst-nat del HTTP al portal) y se avisa en `errores`.
                let codigoEfectivo = modoCodigo
                if (modoCodigo && (await proxyCorteBloqueado(cliente))) {
                    codigoEfectivo = false
                    for (const s of todos) s.url_corte_codigo = null
                    const error = { operacion: 'proxy_corte', mensaje: MENSAJE_PROXY_DEVICE_MODE }
                    salida.errores.push(error)
                    await this.#reportar(t, input.router_id, [error])
                }
                // Corte y FastTrack (siempre, sea cual sea la estrategia): la lista de interfaces, el
                // perfil suspendido, las listas y las reglas, en orden (corte_router.ts).
                if (router.con_credenciales) {
                    const leido: { corte?: LecturaCorte } = {}
                    await paso('corte: leer', async () => {
                        leido.corte = await leerCorteRouter(cliente)
                    })
                    if (leido.corte) {
                        await this.#corte(t, input, salida, {
                            cliente,
                            router,
                            todos,
                            modoCodigo: codigoEfectivo,
                            lectura: leido.corte,
                            ctx: ctxPlan,
                        })
                    }
                }
                const vel: { estado?: ReturnType<typeof estadoVelocidadRouter> } = {}
                if (conVelocidad) {
                    await paso('velocidad', async () => {
                        const lecturaVelocidad = await leerVelocidadRouter(cliente)
                        nodosArbol = lecturaVelocidad.get('/queue/tree')?.length ?? null
                        const velocidad = estadoVelocidadRouter(router.velocidad, planes, lecturaVelocidad)
                        vel.estado = velocidad
                        salida.avisos.push(...velocidad.avisos)
                        salida.errores_velocidad = await reportarReglasOro(
                            t,
                            {
                                router_id: input.router_id,
                                servicio_id: null,
                                evento_id: input.evento_id ?? null,
                            },
                            velocidad,
                        )
                        salida.correcciones.push(
                            ...(await asegurarVelocidad(cliente, velocidad, lecturaVelocidad, ctxPlan)),
                        )
                    })
                }
                // Una lectura por menú: objetos con comment de servicio, agrupados por comment.
                const actuales = new Map<RutaServicio, Map<string, ObjetoRouterOS[]>>()
                const enRouter = new Set<number>()
                const leidos = await paso('servicios: leer', async () => {
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
                })
                if (leidos) {
                    // Huérfanos primero: objetos de servicios que ya no deben estar en este router (retirados,
                    // movidos, eliminados). Su IP, MAC o lease puede haberla tomado otro servicio vigente: si
                    // se borraran al final, el PUT del nuevo chocaría con el viejo y la pasada no convergería.
                    const vigentes = new Set(todos.map((s) => s.servicio_id))
                    for (const id of [...enRouter].filter((s) => !vigentes.has(s)).sort((a, b) => a - b)) {
                        await paso(`servicio ${id}: quitar`, async () => {
                            salida.correcciones.push(
                                ...(await aplicarEstado(cliente, estadoVacio(id), ctx(id), actuales)),
                            )
                        })
                    }
                    // Todos los vigentes (también PPPoE: sus entradas del árbol en `arbol_pcq`). Uno que el
                    // router rechace no impide los demás.
                    for (const servicio of todos) {
                        const estado = estadoDeseado(servicio, router.red, perfilSuspendido())
                        salida.avisos.push(
                            ...estado.avisos.map((a) => `servicio ${servicio.servicio_id}: ${a}`),
                        )
                        await paso(`servicio ${servicio.servicio_id}`, async () => {
                            salida.correcciones.push(
                                ...(await aplicarEstado(
                                    cliente,
                                    estado,
                                    ctx(servicio.servicio_id),
                                    actuales,
                                )),
                            )
                        })
                    }
                }
                // Reglas por servicio del proxy de corte antes de la final sin código y de las del operador.
                if (codigoEfectivo) {
                    await paso('/ip/proxy/access ordenar', async () => {
                        salida.correcciones.push(...(await ordenarAccesoProxy(cliente, ctxPlan)))
                    })
                }
                // Secrets PPPoE (`contratos/pppoe-local.md` §7): después de los perfiles a los que
                // apuntan y antes de borrar los que sobran.
                if (router.con_credenciales) {
                    await paso('secrets ppp', async () => {
                        const { correcciones, avisos, fallidos } = await reconciliarSecrets(
                            cliente,
                            input.router_id,
                            router.red.modo_seguridad ?? 'radius',
                            todos,
                            ctx,
                        )
                        salida.correcciones.push(...correcciones)
                        salida.avisos.push(...avisos)
                        await cerrarSesionesQuitadas(t, input.router_id, sesionesQuitadas(correcciones))
                        for (const f of fallidos) {
                            salida.errores_secrets.push(`servicio ${f.servicio_id}: ${f.error}`)
                            await t.emit('routeros.fallido', {
                                servicio_id: f.servicio_id,
                                router_id: input.router_id,
                                operacion: f.operacion,
                                error: f.error,
                            })
                        }
                    })
                }
                const deseada = vel.estado ?? null
                if (deseada && !(await enTransicion(input.router_id))) {
                    await paso('velocidad: limpiar', async () => {
                        const despues = await leerVelocidadRouter(cliente)
                        salida.correcciones.push(
                            ...(await limpiarVelocidad(cliente, deseada, despues, ctxPlan)),
                        )
                    })
                }
                // QoS por clases: se vuelve a leer y se compara con lo deseado (contratos/qos.md §6).
                if (deseada) {
                    const cambiosQos = salida.correcciones.filter((c) =>
                        esObjetoQos(
                            c.ruta,
                            c.ruta === '/queue/type' ? { name: c.comment } : { comment: c.comment },
                        ),
                    ).length
                    const hayQos = deseada.presentes.some((o) => esObjetoQos(o.ruta, o.clave))
                    if (hayQos || cambiosQos > 0) {
                        await paso('qos: verificar', async () => {
                            const errorQos = await registrarVerificacionQos(
                                t,
                                {
                                    router_id: input.router_id,
                                    evento_id: input.evento_id ?? null,
                                    cambiosQos,
                                },
                                verificarQos(deseada, await leerVelocidadRouter(cliente)),
                            )
                            if (errorQos) salida.errores_velocidad.push(errorQos)
                        })
                    }
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
