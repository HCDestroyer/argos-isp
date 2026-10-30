import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import { routerDispatcher } from '#network/routeros/consultas'
import {
    fabricaPorDefecto,
    LOCK_ROUTEROS,
    marcarPendiente,
    registrarFallo,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'
import { cerrarSesionesQuitadas, idSesionSondeo } from '#network/sesiones/sesiones'

export interface EntradaDesconectarLocal {
    sesion_id: number
    motivo?: string | null
    evento_id?: string | null
}

export interface ResultadoDesconectarLocal {
    sesion_id: number
    router_id: number | null
    /** `quitada`: se quitó de `/ppp/active` y se cerró la fila. `no_aplica`: no es de sondeo o ya terminó. */
    estado: 'quitada' | 'no_estaba' | 'no_aplica' | 'error'
    error: string | null
}

/**
 * `sesion.desconexion_solicitada` de una sesión de sondeo (router sin RADIUS,
 * `contratos/pppoe-local.md` §4): lo que `coa` hace con un Disconnect-Request, por la API REST. Quita
 * la sesión de `/ppp/active` (por su `session-id`), lo deja en `audit.red`, y cierra la fila con
 * `Admin-Reset` (`sesion.terminada`). Si ya no estaba en el router, la cierra igual. Router caído:
 * `routeros.fallido`, la fila sigue abierta y el sondeo la cerrará cuando el router responda.
 */
export default class DesconectarSesionLocal extends DomainAction<
    EntradaDesconectarLocal,
    ResultadoDesconectarLocal
> {
    readonly nombre = 'routeros.desconectar_sesion'
    readonly #opciones: OpcionesDispatcher

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#opciones = opciones
    }

    protected override auditarExito(salida: ResultadoDesconectarLocal): boolean {
        return salida.estado !== 'no_aplica'
    }

    protected async handle(
        input: EntradaDesconectarLocal,
        t: Transaccion,
    ): Promise<ResultadoDesconectarLocal> {
        t.fijarEntidad('sesion', input.sesion_id)
        const salida: ResultadoDesconectarLocal = {
            sesion_id: input.sesion_id,
            router_id: null,
            estado: 'no_aplica',
            error: null,
        }
        const sesion = (await t.trx
            .from('network.sesiones')
            .where('id', input.sesion_id)
            .where('origen', 'sondeo')
            .whereNull('fin')
            .select('id', 'router_id', 'servicio_id', 'acct_session_id', 'user_ppp')
            .first()) as {
            router_id: number | null
            servicio_id: number | null
            acct_session_id: string
            user_ppp: string
        } | null
        if (!sesion || sesion.router_id === null) return salida
        const routerId = Number(sesion.router_id)
        salida.router_id = routerId
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ROUTEROS, routerId])
        const router = await routerDispatcher(routerId, t.trx, this.#opciones.red)
        if (!router) return salida
        const servicioId = sesion.servicio_id === null ? null : Number(sesion.servicio_id)
        const ctx = {
            servicio_id: servicioId,
            evento_id: input.evento_id ?? null,
            request_id: t.ctx.requestId,
            motivo: input.motivo ?? 'desconexion',
        }
        try {
            const cliente = (this.#opciones.clientes ?? fabricaPorDefecto)(router.api)
            let quitadas = 0
            try {
                for (const activa of await cliente.listar('/ppp/active', { name: sesion.user_ppp })) {
                    if (idSesionSondeo(activa) !== sesion.acct_session_id) continue
                    await cliente.desconectarPpp(activa['.id'], ctx)
                    quitadas++
                }
            } finally {
                cliente.cerrar()
            }
            await cerrarSesionesQuitadas(t, routerId, [sesion.acct_session_id])
            salida.estado = quitadas > 0 ? 'quitada' : 'no_estaba'
        } catch (error) {
            if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
            salida.estado = 'error'
            salida.error = error.message
            await registrarFallo({
                router_id: routerId,
                servicio_id: servicioId,
                operacion: 'aplicar',
                evento_id: input.evento_id ?? null,
                request_id: t.ctx.requestId,
                error,
            })
            await t.emit('routeros.fallido', {
                servicio_id: servicioId,
                router_id: routerId,
                operacion:
                    error instanceof ErrorRouterOS && error.operacion ? error.operacion : 'ppp/active remove',
                error: error.message,
            })
            t.alConfirmar(() => marcarPendiente(routerId))
            logger.warn({ sesion_id: input.sesion_id, router_id: routerId, err: error }, 'routeros.fallido')
        }
        return salida
    }
}
