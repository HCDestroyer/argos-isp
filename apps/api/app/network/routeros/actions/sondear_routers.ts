import { DomainAction, type Transaccion } from '#shared/domain_action'
import { registrarContactoRouter } from '#network/contacto_router'
import { routerDispatcher } from '#network/routeros/consultas'
import type { RouterApi } from '#network/routeros/router'
import {
    bitacoraRed,
    fabricaPorDefecto,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export interface EntradaSondear {
    /** Solo se sondean los routers sin contacto periódico en este intervalo (segundos) */
    sin_contacto_desde_s: number
    /** Solo estos routers (pruebas, una corrida a mano); sin él, todos los que tocan */
    router_ids?: number[]
}

export interface ResultadoSondear {
    /** Routers activos con credenciales de API y sin contacto reciente */
    sondeados: number[]
    respondieron: number[]
    sin_respuesta: Array<{ router_id: number; error: string }>
}

/**
 * Sondeo de contacto (`Router.en_linea`, fila 70 de `.claude/integration/a1.md`): un
 * `GET /rest/system/resource` a cada router activo con usuario y contraseña de API que no mandó
 * accounting ni respondió a la API en el último intervalo (madrugada sin sesiones, routers solo
 * WISP). Si responde, anota el contacto con fuente `sondeo`; si no, no escribe nada y `en_linea`
 * pasa a false cuando se cumple el umbral. Un router sin credenciales no se sondea: si tampoco
 * manda accounting, queda «sin dato» (`en_linea` null).
 *
 * Cada GET enviado queda en `audit.red` (`tipo = routeros`, `comando.operacion = sondear`) con la
 * respuesta o el error del equipo, fuera de la transacción (el GET ya ocurrió aunque se revierta).
 * `audit.acciones` solo deja fila si algún router no respondió o falló (excepción de la regla 9
 * de `CLAUDE.md`); los errores de la acción se auditan siempre.
 */
export default class SondearRouters extends DomainAction<EntradaSondear, ResultadoSondear> {
    readonly nombre = 'routeros.sondear'
    readonly #clientes: FabricaClientes

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#clientes = opciones.clientes ?? fabricaPorDefecto
    }

    protected override auditarExito(salida: ResultadoSondear): boolean {
        return salida.sin_respuesta.length > 0
    }

    protected async handle(entrada: EntradaSondear, t: Transaccion): Promise<ResultadoSondear> {
        const { rows } = (await t.trx.rawQuery(
            `SELECT r.id FROM network.routers r
               LEFT JOIN network.routers_contacto rc ON rc.router_id = r.id
              WHERE r.activo
                AND coalesce(r.api_usuario, '') <> '' AND coalesce(r.api_password, '') <> ''
                AND (rc.ultimo_contacto IS NULL
                     OR rc.ultimo_contacto < now() - make_interval(secs => ?))
                ${entrada.router_ids ? 'AND r.id = ANY(?::bigint[])' : ''}
              ORDER BY r.id`,
            [
                Math.max(1, Math.floor(entrada.sin_contacto_desde_s)),
                ...(entrada.router_ids ? [entrada.router_ids] : []),
            ],
        )) as { rows: Array<{ id: number | string }> }
        const resultado: ResultadoSondear = { sondeados: [], respondieron: [], sin_respuesta: [] }
        for (const fila of rows) {
            const id = Number(fila.id)
            const router = await routerDispatcher(id, t.trx)
            if (!router) continue
            resultado.sondeados.push(id)
            const sondeo = await sondearRouter(t, router.api, this.#clientes, 'sondear')
            if (sondeo.ok) resultado.respondieron.push(id)
            else resultado.sin_respuesta.push({ router_id: id, error: sondeo.error.message })
        }
        return resultado
    }
}

export type ResultadoSondeo =
    | { ok: true; recurso: Record<string, unknown>; ms: number; host: string }
    | {
          ok: false
          error: Error & { status?: number | null; tipo?: string; codigo?: string | null }
          ms: number
      }

/**
 * Un `GET /rest/system/resource` al router (sondeo de contacto y `routers.probar_conexion`): si
 * responde, anota el contacto con fuente `sondeo` (`Router.en_linea`, `ultimo_contacto`) en la
 * transacción de la acción. El GET queda en `audit.red` con su respuesta o error, fuera de la
 * transacción. Nunca lanza: devuelve el error del cliente.
 */
export async function sondearRouter(
    t: Transaccion,
    api: RouterApi,
    clientes: FabricaClientes,
    operacion: string,
): Promise<ResultadoSondeo> {
    let cliente
    const comando = { operacion, metodo: 'GET', ruta: '/system/resource', request_id: t.ctx.requestId }
    const inicio = performance.now()
    try {
        // Sin el aviso de contacto del cliente: aquí se anota con fuente `sondeo`.
        cliente = clientes(api, { sinContacto: true })
        const recurso = await cliente.probar()
        const ms = Math.round(performance.now() - inicio)
        await registrarContactoRouter(t.trx, { routerId: api.id }, 'sondeo')
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: api.id,
            servicio_id: null,
            comando: { ...comando, host: cliente.host },
            respuesta: { status: 200, rtt_ms: ms },
            ok: true,
        })
        return { ok: true, recurso, ms, host: cliente.host }
    } catch (error) {
        const e = error as Error & { status?: number | null; tipo?: string; codigo?: string | null }
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: api.id,
            servicio_id: null,
            comando: { ...comando, host: cliente?.host ?? null },
            respuesta: { status: e.status ?? null, error: e.message, tipo_error: e.tipo ?? 'inalcanzable' },
            ok: false,
        })
        return { ok: false, error: e, ms: Math.round(performance.now() - inicio) }
    } finally {
        cliente?.cerrar()
    }
}
