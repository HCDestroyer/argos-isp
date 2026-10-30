import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import type { ObjetoRouterOS } from '#network/routeros/cliente'
import { routerDispatcher } from '#network/routeros/consultas'
import { fabricaPorDefecto, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import {
    actualizarSesionSondeo,
    CAUSA_SONDEO,
    cerrarReemplazadas,
    cerrarSesiones,
    emitirIniciada,
    emitirTerminada,
    insertarSesionSondeo,
    idSesionSondeo,
    sesionesSondeoAbiertas,
} from '#network/sesiones/sesiones'

export interface EntradaSondearPpp {
    router_id: number
    /** Instante del sondeo (ISO): `inicio` estimado de las nuevas y `fin` de las que ya no están */
    ahora?: string
}

export interface ResultadoSondearPpp {
    router_id: number
    /** Sesiones PPPoE que el router tiene activas en este sondeo */
    activas: number
    abiertas: number[]
    cerradas: number[]
    /** Sesiones abiertas a las que se les completó IPv4 o prefijo */
    actualizadas: number[]
    /** El router no respondió: no se abrió ni cerró nada (no se sabe qué pasó) */
    error: string | null
    /** Router inexistente, inactivo, sin credenciales o con RADIUS y sin sesiones de sondeo */
    omitido: boolean
}

/** Espacio de advisory locks del sondeo por router (dos sondeos del mismo router no se cruzan). */
export const LOCK_SONDEO_PPP = 4105

/** `1w2d3h4m5s` / `3h12m` / `45s` (formato de `uptime` de RouterOS 7) → segundos; null si no se entiende. */
export function segundosUptime(uptime: string | undefined): number | null {
    if (!uptime) return null
    const m = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(uptime.trim())
    if (!m || uptime.trim() === '') return null
    const [, w, d, h, min, s] = m.map((v) => Number(v ?? 0))
    return w! * 604800 + d! * 86400 + h! * 3600 + min! * 60 + s!
}

/**
 * Sondeo de sesiones PPPoE de un router sin RADIUS (`contratos/pppoe-local.md` §6): sin accounting no
 * hay Start ni Stop, así que se lee `/ppp/active` (y `/ipv6/dhcp-server/binding` para el /56) y se
 * abren y cierran las filas de `network.sesiones` con `origen = 'sondeo'`, emitiendo
 * `sesion.iniciada` / `sesion.terminada` como el accounting: el portal identifica al cliente por IP y
 * el resto del sistema no cambia.
 *
 * - Nueva en el router → fila abierta (`acct_session_id = sondeo:<session-id>`, `inicio` = ahora −
 *   `uptime`, IPv4, /64 de la asignación en `radius_servicio`, /56 del binding si ya está) y
 *   `sesion.iniciada`; cierra otras abiertas del mismo usuario (`Sesion-Reemplazada`).
 * - Ya no está → `fin` = ahora, causa `sondeo_sin_sesion`, `sesion.terminada` y su diff en
 *   `audit.cambios`.
 * - Sigue → se completan IPv4 y prefijos si cambiaron (sin evento).
 * - Sin contadores de consumo (`bytes_in` / `bytes_out` quedan en 0): RouterOS no los da por sesión
 *   sin accounting.
 * - Router caído: no se toca nada (no se sabe si las sesiones siguen) y se devuelve el error; el
 *   contacto y `routeros.fallido` son del cron `sondear` y del dispatcher.
 * - También corre en un router que pasó de `api` a `radius` mientras le queden sesiones de sondeo
 *   abiertas, hasta que se cierren.
 * - Solo lecturas en el router (no van a `audit.red`). Auditoría solo si abrió o cerró algo, o falló
 *   (telemetría de alta frecuencia, como `sesiones.cerrar_colgadas`).
 */
export default class SondearSesionesPpp extends DomainAction<EntradaSondearPpp, ResultadoSondearPpp> {
    readonly nombre = 'sesiones.sondear_ppp'
    readonly #opciones: OpcionesDispatcher

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#opciones = opciones
    }

    protected override auditarExito(salida: ResultadoSondearPpp): boolean {
        return salida.abiertas.length > 0 || salida.cerradas.length > 0 || salida.error !== null
    }

    protected async handle(input: EntradaSondearPpp, t: Transaccion): Promise<ResultadoSondearPpp> {
        t.fijarEntidad('router', input.router_id)
        const ahora = input.ahora ? new Date(input.ahora) : new Date()
        const salida: ResultadoSondearPpp = {
            router_id: input.router_id,
            activas: 0,
            abiertas: [],
            cerradas: [],
            actualizadas: [],
            error: null,
            omitido: false,
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_SONDEO_PPP, input.router_id])
        const router = await routerDispatcher(input.router_id, t.trx, this.#opciones.red)
        const abiertas = await sesionesSondeoAbiertas(t, input.router_id)
        if (
            !router ||
            !router.activo ||
            !router.con_credenciales ||
            (router.red.modo_seguridad !== 'api' && abiertas.length === 0)
        ) {
            salida.omitido = true
            return salida
        }

        let activas: ObjetoRouterOS[]
        let bindings: ObjetoRouterOS[]
        try {
            const cliente = (this.#opciones.clientes ?? fabricaPorDefecto)(router.api)
            try {
                const leidas = await cliente.listar('/ppp/active')
                activas = leidas.filter((a) => !a.service || a.service === 'pppoe')
                bindings = await cliente.listar('/ipv6/dhcp-server/binding')
            } finally {
                cliente.cerrar()
            }
        } catch (error) {
            if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
            salida.error = error.message
            return salida
        }
        salida.activas = activas.length

        const nasIp =
            (
                (await t.trx
                    .from('network.routers')
                    .where('id', input.router_id)
                    .select(t.trx.raw('host(nas_ip) AS nas_ip'))
                    .first()) as { nas_ip: string | null } | null
            )?.nas_ip ?? null
        const delegadoDe = (usuario: string) =>
            bindings
                .filter((b) => b.server === `<pppoe-${usuario}>`)
                .map((b) => b.address)
                .find((a): a is string => typeof a === 'string' && a.includes(':') && a.includes('/')) ?? null
        const porId = new Map(activas.map((a) => [idSesionSondeo(a), a]))

        // Cierre: las abiertas que el router ya no tiene.
        for (const sesion of abiertas) {
            if (porId.has(sesion.acct_session_id)) continue
            const [cerrada] = await cerrarSesiones(
                t,
                { sql: 'id = ?', valores: [sesion.id] },
                ahora.toISOString(),
                CAUSA_SONDEO,
            )
            if (!cerrada) continue
            await t.registrarCambios(
                { tipo: 'sesion', id: cerrada.id },
                { fin: null, causa_fin: null },
                { fin: cerrada.fin?.toISOString() ?? null, causa_fin: cerrada.causa_fin },
            )
            await emitirTerminada(t, cerrada)
            salida.cerradas.push(cerrada.id)
        }

        // Apertura y actualización.
        const yaAbiertas = new Map(abiertas.map((s) => [s.acct_session_id, s]))
        for (const [acct, activa] of porId) {
            const usuario = activa.name ?? ''
            if (usuario === '') continue
            const ipv4 = activa.address && !activa.address.includes(':') ? activa.address : null
            const delegado = delegadoDe(usuario)
            const existente = yaAbiertas.get(acct)
            if (existente) {
                if (
                    (ipv4 && ipv4 !== existente.ipv4) ||
                    (delegado && delegado !== existente.prefijo_delegado_v6)
                ) {
                    await actualizarSesionSondeo(t, existente.id, {
                        ipv4,
                        prefijo_enlace_v6: null,
                        prefijo_delegado_v6: delegado,
                    })
                    salida.actualizadas.push(existente.id)
                }
                continue
            }
            const servicio = (await t.trx
                .from('core.servicios')
                .where('user_ppp', usuario)
                .select(
                    'id',
                    t.trx.raw(`(SELECT a.prefijo::text FROM network.ipv6_asignaciones a
                         WHERE a.servicio_id = core.servicios.id AND a.fin IS NULL AND a.tipo = 'enlace'
                           AND core.servicios.ipv6_modo = 'radius_servicio' LIMIT 1) AS enlace`),
                )
                .first()) as { id: number | string; enlace: string | null } | null
            const uptime = segundosUptime(activa.uptime)
            const nueva = await insertarSesionSondeo(t, {
                router_id: input.router_id,
                nas_ip: nasIp,
                acct_session_id: acct,
                user_ppp: usuario,
                ipv4,
                prefijo_enlace_v6: servicio?.enlace ?? null,
                prefijo_delegado_v6: delegado,
                inicio: new Date(ahora.getTime() - (uptime ?? 0) * 1000).toISOString(),
                servicio_id: servicio ? Number(servicio.id) : null,
            })
            if (!nueva) continue
            await emitirIniciada(t, nueva)
            await cerrarReemplazadas(t, nueva)
            salida.abiertas.push(nueva.id)
        }
        return salida
    }
}
