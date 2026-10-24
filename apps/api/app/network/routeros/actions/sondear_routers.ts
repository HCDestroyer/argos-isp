import { DomainAction, type Transaccion } from '#shared/domain_action'
import { registrarContactoRouter } from '#network/contacto_router'
import { routerDispatcher } from '#network/routeros/consultas'
import {
    fabricaPorDefecto,
    type FabricaClientes,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

export interface EntradaSondear {
    /** Solo se sondean los routers sin contacto periódico en este intervalo (segundos) */
    sin_contacto_desde_s: number
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
 * Solo lee del router (no deja filas en `audit.red`, que es para comandos). Se audita cada
 * corrida (una cada 5 minutos por defecto).
 */
export default class SondearRouters extends DomainAction<EntradaSondear, ResultadoSondear> {
    readonly nombre = 'routeros.sondear'
    readonly #clientes: FabricaClientes

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#clientes = opciones.clientes ?? fabricaPorDefecto
    }

    protected async handle(entrada: EntradaSondear, t: Transaccion): Promise<ResultadoSondear> {
        const { rows } = (await t.trx.rawQuery(
            `SELECT r.id FROM network.routers r
               LEFT JOIN network.routers_contacto rc ON rc.router_id = r.id
              WHERE r.activo
                AND coalesce(r.api_usuario, '') <> '' AND coalesce(r.api_password, '') <> ''
                AND (rc.ultimo_contacto IS NULL
                     OR rc.ultimo_contacto < now() - make_interval(secs => ?))
              ORDER BY r.id`,
            [Math.max(1, Math.floor(entrada.sin_contacto_desde_s))],
        )) as { rows: Array<{ id: number | string }> }
        const resultado: ResultadoSondear = { sondeados: [], respondieron: [], sin_respuesta: [] }
        for (const fila of rows) {
            const id = Number(fila.id)
            const router = await routerDispatcher(id, t.trx)
            if (!router) continue
            resultado.sondeados.push(id)
            let cliente
            try {
                // Sin el aviso de contacto del cliente: aquí se anota con fuente `sondeo`.
                cliente = this.#clientes(router.api, { sinContacto: true })
                await cliente.probar()
                await registrarContactoRouter(t.trx, { routerId: id }, 'sondeo')
                resultado.respondieron.push(id)
            } catch (error) {
                resultado.sin_respuesta.push({ router_id: id, error: (error as Error).message })
            } finally {
                cliente?.cerrar()
            }
        }
        return resultado
    }
}
