import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import { estadoDeseado, estadoVacio } from '#network/routeros/estado_deseado'
import {
    planesDeRouter,
    routerDispatcher,
    servicioRed,
    serviciosVigentesDeRouter,
} from '#network/routeros/consultas'
import { estadoVelocidadRouter } from '#network/routeros/velocidad_router'
import { guardarLecturaColas } from '#network/routeros/metricas'
import { bloquearSesionesAbiertas, solicitarDesconexion } from '#network/sesiones/desconexion'
import type { ControlVelocidad } from '#network/velocidad'
import {
    aplicarEstado,
    asegurarVelocidad,
    bitacoraRed,
    fabricaPorDefecto,
    leerVelocidadRouter,
    limpiarVelocidad,
    LOCK_ROUTEROS,
    marcarPendiente,
    perfilSuspendido,
    registrarFallo,
    reportarReglasOro,
    type Cambio,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export type FaseControl = 'preparar' | 'lote' | 'terminar'

export interface EntradaMigrarControl {
    router_id: number
    fase: FaseControl
    de: ControlVelocidad
    a: ControlVelocidad
    /** id del evento `router.control_cambiado` (va a `audit.red`) */
    evento_id: string | null
    /** fase `lote`: servicios del lote */
    servicio_ids?: number[]
    /** fase `lote`: pedir Disconnect a las sesiones PPPoE del lote (entran con el perfil del modo nuevo) */
    desconectar_pppoe?: boolean
    /** número de lote (1…n) y total, para `audit.red` */
    lote?: number
    lotes?: number
}

export interface ResultadoMigrarControl {
    router_id: number
    fase: FaseControl
    cambios: Cambio[]
    /** Sesiones PPPoE a las que se pidió Disconnect en este lote */
    desconexiones: number
    avisos: string[]
    error: string | null
    /** Reglas de oro incumplidas (no se escribió el padre o el árbol; `routeros.fallido`) */
    errores_velocidad: string[]
    /** El router ya no está en el modo `a` (otro cambio lo superó): no se hace nada */
    superado: boolean
}

/**
 * Un paso del cambio de modo de control de un router (`router.control_cambiado`; orquesta
 * `cambio_control.ts`, que corre en el worker de RouterOS con pausas entre lotes):
 *
 * - `preparar`: crea los objetos del modo nuevo (árbol, PCQ y mangle; o padres y perfiles) sin
 *   tocar los del anterior (el orquestador marca el router en transición: los eventos no borran lo viejo).
 * - `lote`: migra un lote de servicios: estado deseado completo de cada uno en el modo nuevo
 *   (cola simple ↔ entradas de lista) y, si se pide, Disconnect de sus sesiones PPPoE
 *   (`sesion.desconexion_solicitada`, lo ejecuta `coa`) para que entren con los atributos del modo
 *   nuevo (`Mikrotik-Rate-Limit` y `Mikrotik-Group` en `simple`; nada en `arbol_pcq`).
 * - `terminar`: recalcula y borra lo que sobra del modo anterior (sin colas huérfanas).
 *
 * Reversible: volver al modo anterior es el mismo cambio con `de` y `a` invertidos. El estado
 * deseado sale siempre de Postgres, así que repetir un paso no duplica nada. Cada escritura queda
 * en `audit.red` y cada paso deja además una fila `operacion = cambiar_control` con su resultado.
 * Si el router no responde: `routeros.fallido`, queda pendiente y el reconciliador termina de
 * converger al modo vigente cuando vuelva.
 */
export default class MigrarControlRouterOS extends DomainAction<
    EntradaMigrarControl,
    ResultadoMigrarControl
> {
    readonly nombre = 'routeros.cambiar_control'
    readonly #fabrica: FabricaClientes
    readonly #red: OpcionesDispatcher['red']

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#fabrica = opciones.clientes ?? fabricaPorDefecto
        this.#red = opciones.red
    }

    protected async handle(input: EntradaMigrarControl, t: Transaccion): Promise<ResultadoMigrarControl> {
        t.fijarEntidad('router', input.router_id)
        const salida: ResultadoMigrarControl = {
            router_id: input.router_id,
            fase: input.fase,
            cambios: [],
            desconexiones: 0,
            avisos: [],
            error: null,
            errores_velocidad: [],
            superado: false,
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ROUTEROS, input.router_id])
        const router = await routerDispatcher(input.router_id, t.trx, this.#red)
        if (!router) {
            salida.superado = true
            return salida
        }
        if (router.velocidad.control !== input.a) {
            // Otro cambio posterior ya lo devolvió: ese evento hará su propia transición.
            salida.superado = true
            salida.avisos.push(`el router está en ${router.velocidad.control}, no en ${input.a}`)
            return salida
        }
        const ctx = {
            servicio_id: null,
            evento_id: input.evento_id,
            request_id: t.ctx.requestId,
            motivo: `cambiar control ${input.de} → ${input.a}: ${input.fase}`,
        }
        const todos = await serviciosVigentesDeRouter(input.router_id, t.trx)
        const planes = planesDeRouter(router.velocidad, todos)

        try {
            const cliente = this.#fabrica(router.api)
            try {
                if (input.fase === 'preparar' || input.fase === 'terminar') {
                    const lectura = await leerVelocidadRouter(cliente)
                    const velocidad = estadoVelocidadRouter(router.velocidad, planes, lectura)
                    salida.avisos.push(...velocidad.avisos)
                    salida.errores_velocidad = await reportarReglasOro(
                        t,
                        { router_id: input.router_id, servicio_id: null, evento_id: input.evento_id },
                        velocidad,
                    )
                    salida.cambios.push(...(await asegurarVelocidad(cliente, velocidad, lectura, ctx)))
                    if (input.fase === 'terminar') {
                        const despues = await leerVelocidadRouter(cliente)
                        salida.cambios.push(...(await limpiarVelocidad(cliente, velocidad, despues, ctx)))
                        // Métrica de colas por router con el modo nuevo (la de A6 no espera al reconciliador).
                        const final = await leerVelocidadRouter(cliente)
                        const simples = final.get('/queue/simple')?.length ?? 0
                        const arbol = final.get('/queue/tree')?.length ?? 0
                        t.alConfirmar(() =>
                            guardarLecturaColas(input.router_id, router.nombre, simples, {
                                arbol,
                                control: input.a,
                            }),
                        )
                    }
                } else {
                    for (const id of input.servicio_ids ?? []) {
                        const servicio = await servicioRed(id, t.trx)
                        const propio = servicio !== null && servicio.router_id === input.router_id
                        const estado = propio
                            ? estadoDeseado(servicio, router.red, perfilSuspendido())
                            : estadoVacio(id)
                        salida.avisos.push(...estado.avisos.map((a) => `servicio ${id}: ${a}`))
                        salida.cambios.push(
                            ...(await aplicarEstado(cliente, estado, { ...ctx, servicio_id: id })),
                        )
                        if (input.desconectar_pppoe && propio && servicio.tipo_conexion === 'pppoe') {
                            for (const sesion of await bloquearSesionesAbiertas(t, id)) {
                                await solicitarDesconexion(
                                    t,
                                    sesion,
                                    `cambio de control de velocidad ${input.de} → ${input.a}`,
                                )
                                salida.desconexiones++
                            }
                        }
                    }
                }
            } finally {
                cliente.cerrar()
            }
        } catch (error) {
            if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
            salida.error = error.message
            await registrarFallo({
                router_id: input.router_id,
                servicio_id: null,
                operacion: 'cambiar_control',
                evento_id: input.evento_id,
                request_id: t.ctx.requestId,
                error,
            })
            await t.emit('routeros.fallido', {
                servicio_id: null,
                router_id: input.router_id,
                operacion: `cambiar control ${input.de} → ${input.a} (${input.fase})`,
                error: error.message,
            })
            t.alConfirmar(() => marcarPendiente(input.router_id))
            logger.warn({ router_id: input.router_id, err: error }, 'routeros.fallido (cambiar control)')
        }

        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: input.router_id,
            servicio_id: null,
            comando: {
                operacion: 'cambiar_control',
                fase: input.fase,
                de: input.de,
                a: input.a,
                lote: input.lote ?? null,
                lotes: input.lotes ?? null,
                servicios: input.servicio_ids?.length ?? null,
                evento_id: input.evento_id,
                request_id: t.ctx.requestId,
            },
            respuesta: {
                cambios: salida.cambios.length,
                creados: salida.cambios.filter((c) => c.accion === 'creado').length,
                actualizados: salida.cambios.filter((c) => c.accion === 'actualizado').length,
                borrados: salida.cambios.filter((c) => c.accion === 'borrado').length,
                desconexiones: salida.desconexiones,
                error: salida.error,
                final: input.fase === 'terminar' || salida.error !== null,
            },
            ok: salida.error === null,
        })
        return salida
    }
}
