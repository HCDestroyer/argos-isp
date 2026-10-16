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
import { routerDispatcher, serviciosRedDeRouter } from '#network/routeros/consultas'
import {
    aplicarEstado,
    fabricaPorDefecto,
    LOCK_ROUTEROS,
    marcarPendiente,
    perfilSuspendido,
    registrarFallo,
    quitarPendiente,
    type Cambio,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export interface EntradaReconciliar {
    router_id: number
    /** `periodico` (red de seguridad), `recuperado` (el router volvió), `plan` (cambió la velocidad), `manual` */
    motivo: 'periodico' | 'recuperado' | 'plan' | 'manual'
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

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#fabrica = opciones.clientes ?? fabricaPorDefecto
        this.#red = opciones.red
    }

    protected auditarExito(salida: ResultadoReconciliar): boolean {
        return salida.correcciones.length > 0 || salida.error !== null
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
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ROUTEROS, input.router_id])
        const router = await routerDispatcher(input.router_id, t.trx, this.#red)
        if (!router || !router.activo) {
            salida.omitido = true
            t.alConfirmar(() => quitarPendiente(input.router_id))
            return salida
        }
        const servicios = await serviciosRedDeRouter(input.router_id, t.trx)
        salida.servicios = servicios.length
        const ctx = (servicioId: number) => ({
            servicio_id: servicioId,
            evento_id: input.evento_id ?? null,
            request_id: t.ctx.requestId,
            motivo: `reconciliar: ${input.motivo}`,
        })

        try {
            const cliente = this.#fabrica(router.api)
            try {
                // Una lectura por menú: objetos con comment de servicio, agrupados por comment.
                const actuales = new Map<RutaServicio, Map<string, ObjetoRouterOS[]>>()
                const enRouter = new Set<number>()
                for (const ruta of RUTAS_SERVICIO) {
                    const porComment = new Map<string, ObjetoRouterOS[]>()
                    for (const objeto of await cliente.listar(ruta)) {
                        const id = servicioDeComment(objeto.comment)
                        if (id === null) continue
                        enRouter.add(id)
                        const lista = porComment.get(objeto.comment!) ?? []
                        lista.push(objeto)
                        porComment.set(objeto.comment!, lista)
                    }
                    actuales.set(ruta, porComment)
                }
                const vigentes = new Set(servicios.map((s) => s.servicio_id))
                for (const servicio of servicios) {
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
            } finally {
                cliente.cerrar()
            }
            t.alConfirmar(() => quitarPendiente(input.router_id))
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
