import { DomainAction, type Transaccion } from '#shared/domain_action'
import { registrarContactoRouter, umbralEnLineaS } from '#network/contacto_router'
import { routerDispatcher } from '#network/routeros/consultas'
import { identificarRouter } from '#network/routeros/identidad'
import type { RouterApi } from '#network/routeros/router'
import type { ClienteRouterOS } from '#network/routeros/cliente'
import { diagnosticarErrorRouterOS, type DiagnosticoRouterOS } from '#network/diagnostico_routeros'
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
    /** `error`: el texto técnico; `motivo`/`detalle`: en lenguaje simple (`diagnostico_routeros.ts`) */
    sin_respuesta: Array<{ router_id: number; error: string; motivo: string; detalle: string }>
}

/**
 * Sondeo de contacto (`Router.en_linea`, fila 70 de `.claude/integration/a1.md`): un
 * `GET /rest/system/resource` a cada router activo con usuario y contraseña de API que no mandó
 * accounting ni respondió a la API en el último intervalo (madrugada sin sesiones, routers solo
 * WISP). Si responde, anota el contacto con fuente `sondeo`; si no, no escribe nada y `en_linea`
 * pasa a false cuando se cumple el umbral. Un router sin credenciales no se sondea: si tampoco
 * manda accounting, queda «sin dato» (`en_linea` null).
 *
 * Si responde y su serial no se conoce, o vuelve de estar caído (sin contacto en el umbral de
 * `en_linea`), además lee su número de serie (`identificarRouter`, `contratos/routers.md`).
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
            `SELECT r.id, r.serial IS NULL AS sin_serial,
                    (rc.ultimo_contacto IS NULL
                     OR rc.ultimo_contacto < now() - make_interval(secs => ?)) AS caido
               FROM network.routers r
               LEFT JOIN network.routers_contacto rc ON rc.router_id = r.id
              WHERE r.activo
                AND coalesce(r.api_usuario, '') <> '' AND coalesce(r.api_password, '') <> ''
                AND (rc.ultimo_contacto IS NULL
                     OR rc.ultimo_contacto < now() - make_interval(secs => ?))
                ${entrada.router_ids ? 'AND r.id = ANY(?::bigint[])' : ''}
              ORDER BY r.id`,
            [
                umbralEnLineaS(),
                Math.max(1, Math.floor(entrada.sin_contacto_desde_s)),
                ...(entrada.router_ids ? [entrada.router_ids] : []),
            ],
        )) as { rows: Array<{ id: number | string; sin_serial: boolean; caido: boolean }> }
        const resultado: ResultadoSondear = { sondeados: [], respondieron: [], sin_respuesta: [] }
        for (const fila of rows) {
            const id = Number(fila.id)
            const router = await routerDispatcher(id, t.trx)
            if (!router) continue
            resultado.sondeados.push(id)
            // A1: número de serie del equipo para detectar routers duplicados (`contratos/routers.md`),
            // solo si no se conoce o el router vuelve de estar caído (pudo cambiar el equipo)
            const identificar =
                fila.sin_serial || fila.caido
                    ? (cliente: ClienteRouterOS) => identificarRouter(t, cliente, id)
                    : undefined
            const sondeo = await sondearRouter(t, router.api, this.#clientes, 'sondear', identificar)
            if (sondeo.ok) resultado.respondieron.push(id)
            else {
                resultado.sin_respuesta.push({
                    router_id: id,
                    error: sondeo.error.message,
                    motivo: sondeo.diagnostico.motivo,
                    detalle: sondeo.diagnostico.detalle,
                })
            }
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
          host: string | null
          /** el error en lenguaje simple (`diagnostico_routeros.ts`) */
          diagnostico: DiagnosticoRouterOS
      }

/**
 * Un `GET /rest/system/resource` al router (sondeo de contacto y `routers.probar_conexion`): si
 * responde, anota el contacto con fuente `sondeo` (`Router.en_linea`, `ultimo_contacto`) en la
 * transacción de la acción. El GET queda en `audit.red` con su respuesta o error, fuera de la
 * transacción. Nunca lanza: devuelve el error del cliente.
 *
 * `alResponder` corre con el mismo cliente (antes de cerrarlo) solo si el router respondió: el
 * sondeo lo usa para leer el serial (`identificarRouter`, que tampoco lanza por el equipo).
 */
export async function sondearRouter(
    t: Transaccion,
    api: RouterApi,
    clientes: FabricaClientes,
    operacion: string,
    alResponder?: (cliente: ClienteRouterOS) => Promise<unknown>,
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
        if (alResponder) await alResponder(cliente)
        return { ok: true, recurso, ms, host: cliente.host }
    } catch (error) {
        const e = error as Error & { status?: number | null; tipo?: string; codigo?: string | null }
        const host = cliente?.host ?? null
        const diagnostico = diagnosticarErrorRouterOS(e, host ?? api.host)
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: api.id,
            servicio_id: null,
            comando: { ...comando, host },
            respuesta: {
                status: e.status ?? null,
                error: e.message,
                tipo_error: e.tipo ?? 'inalcanzable',
                motivo: diagnostico.motivo,
                detalle: diagnostico.detalle,
            },
            ok: false,
        })
        return { ok: false, error: e, ms: Math.round(performance.now() - inicio), host, diagnostico }
    } finally {
        cliente?.cerrar()
    }
}
