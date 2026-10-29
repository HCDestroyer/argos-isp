import pg from 'pg'
import type { EstadoServicio, ServicioActual } from './decision.ts'
import type { TipoPaquete } from './nas.ts'
import type { FuenteRateLimits } from './registro.ts'

/**
 * Lo que `coa` lee y escribe en Postgres. `coa` no pasa por `apps/api`: lee el estado vigente del
 * servicio y las sesiones abiertas (`network.sesiones`, las escribe `sesiones:worker`), y escribe
 * `audit.red` (cada envío con su respuesta) y, al agotar reintentos, `coa.fallido` en
 * `audit.outbox` en la MISMA transacción que la fila de `audit.red` del último intento.
 */

/**
 * Destino del CoA: el router **de la sesión** (`network.sesiones.router_id`, que el accounting fija
 * por el `NAS-IP-Address` del Start), con su `nas_ip` y su `radius_secret` **actuales**. Así una
 * sesión abierta antes de que el router se registrara por el túnel WireGuard (su `nas_ip` pasó a la
 * IP del túnel, `contratos/conexion-routers.md` §6.4) recibe el CoA por el túnel sin desconectarla.
 * Solo una sesión sin router (`router_id` null: el NAS no estaba dado de alta al abrirla) se resuelve
 * por `sesiones.nas_ip`, como antes.
 */
export interface SesionActiva {
    id: number
    /** IP a la que se envía: la `nas_ip` actual del router de la sesión, o la de la sesión sin router */
    nas_ip: string
    /** `network.sesiones.nas_ip` (la del Start); distinta de `nas_ip` si el router cambió de IP */
    nas_ip_sesion?: string
    acct_session_id: string
    user_ppp: string
    router_id: number | null
    /** `network.routers.radius_secret` cifrado (v1) o null si el NAS no está dado de alta */
    radius_secret: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
}

/** Sesión abierta buscada por id (desconexión manual); puede no tener servicio conocido. */
export interface SesionPorId extends SesionActiva {
    servicio_id: number | null
}

export interface FilaRed {
    tipo: TipoPaquete
    router_id: number | null
    servicio_id: number | null
    comando: Record<string, unknown>
    respuesta: Record<string, unknown>
    ok: boolean
}

export interface CoaFallido {
    servicio_id: number | null
    nas_ip: string
    tipo: TipoPaquete
    error: string
}

export interface Almacen {
    servicio(servicioId: number): Promise<ServicioActual | null>
    sesionesActivas(servicioId: number): Promise<SesionActiva[]>
    /** La sesión si sigue abierta (sin `fin`); null si no existe o ya terminó. */
    sesionAbierta(sesionId: number): Promise<SesionPorId | null>
    /** true si el evento ya terminó para esa sesión (ACK, NAK o reintentos agotados). */
    yaProcesado(eventoId: string, servicioId: number | null, sesionId: number): Promise<boolean>
    /** Registra un envío; con `fallido`, además emite `coa.fallido` en la misma transacción. */
    registrar(fila: FilaRed, fallido?: { payload: CoaFallido; requestId: string | null }): Promise<void>
}

export class AlmacenPg implements Almacen {
    readonly pool: pg.Pool
    readonly #rateLimits: FuenteRateLimits | null

    /**
     * `rateLimits`: de dónde salen las cadenas completas de `Mikrotik-Rate-Limit` (Redis
     * `aaa:user:*` y, si falta, la API interna; `registro.ts`). Sin fuente, los CoA de velocidad fallan.
     */
    constructor(config: pg.PoolConfig, rateLimits: FuenteRateLimits | null = null) {
        this.pool = new pg.Pool({ max: 5, ...config })
        this.#rateLimits = rateLimits
        this.pool.on('error', () => {
            // Una conexión inactiva que se cae no debe tumbar el proceso; la siguiente consulta reconecta.
        })
    }

    async servicio(servicioId: number): Promise<ServicioActual | null> {
        const { rows } = await this.pool.query<{
            user_ppp: string | null
            estado: EstadoServicio
            control_velocidad: 'simple' | 'arbol_pcq' | null
        }>(
            `SELECT s.user_ppp, s.estado, r.control_velocidad
             FROM core.servicios s LEFT JOIN network.routers r ON r.id = s.router_id
             WHERE s.id = $1`,
            [servicioId],
        )
        const fila = rows[0]
        if (!fila) return null
        const control = fila.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple'
        const servicio: ServicioActual = {
            servicio_id: servicioId,
            estado: fila.estado,
            rate_limit: null,
            rate_limit_limitado: null,
            control_velocidad: control,
        }
        // Solo activo y limitado llevan rate-limit por CoA; sin user_ppp no hay sesión PPPoE; en
        // `arbol_pcq` la velocidad no viaja por RADIUS (la ponen las listas del árbol).
        if ((fila.estado !== 'activo' && fila.estado !== 'limitado') || !fila.user_ppp) return servicio
        if (control === 'arbol_pcq') return servicio
        if (!this.#rateLimits) return { ...servicio, error_rate_limit: 'coa sin fuente de rate-limit' }
        const r = await this.#rateLimits.obtener(servicioId, fila.user_ppp)
        // El control del router sale de Postgres (vigente), no del registro.
        return r.ok
            ? { ...servicio, ...r.valor, control_velocidad: control }
            : { ...servicio, error_rate_limit: r.error }
    }

    async sesionesActivas(servicioId: number): Promise<SesionActiva[]> {
        const { rows } = await this.pool.query<SesionActiva>(
            `SELECT ses.id::int AS id, COALESCE(host(r.nas_ip), host(ses.nas_ip)) AS nas_ip,
                    host(ses.nas_ip) AS nas_ip_sesion, ses.acct_session_id, ses.user_ppp,
                    r.id::int AS router_id, r.radius_secret,
                    ses.prefijo_enlace_v6::text AS prefijo_enlace_v6,
                    ses.prefijo_delegado_v6::text AS prefijo_delegado_v6
             FROM network.sesiones ses
             LEFT JOIN network.routers r ON r.id = COALESCE(
                 ses.router_id,
                 (SELECT r2.id FROM network.routers r2 WHERE r2.nas_ip = ses.nas_ip ORDER BY r2.id LIMIT 1)
             )
             WHERE ses.servicio_id = $1 AND ses.fin IS NULL
             ORDER BY ses.inicio`,
            [servicioId],
        )
        return rows
    }

    async sesionAbierta(sesionId: number): Promise<SesionPorId | null> {
        const { rows } = await this.pool.query<SesionPorId>(
            `SELECT ses.id::int AS id, ses.servicio_id::int AS servicio_id,
                    COALESCE(host(r.nas_ip), host(ses.nas_ip)) AS nas_ip, host(ses.nas_ip) AS nas_ip_sesion,
                    ses.acct_session_id, ses.user_ppp, r.id::int AS router_id, r.radius_secret,
                    ses.prefijo_enlace_v6::text AS prefijo_enlace_v6,
                    ses.prefijo_delegado_v6::text AS prefijo_delegado_v6
             FROM network.sesiones ses
             LEFT JOIN network.routers r ON r.id = COALESCE(
                 ses.router_id,
                 (SELECT r2.id FROM network.routers r2 WHERE r2.nas_ip = ses.nas_ip ORDER BY r2.id LIMIT 1)
             )
             WHERE ses.id = $1 AND ses.fin IS NULL`,
            [sesionId],
        )
        return rows[0] ?? null
    }

    async yaProcesado(eventoId: string, servicioId: number | null, sesionId: number): Promise<boolean> {
        // `servicio_id = $3` usa el índice `red_servicio`; null solo en desconexiones manuales.
        const servicio = servicioId === null ? 'servicio_id IS NULL' : 'servicio_id = $3'
        const { rowCount } = await this.pool.query(
            `SELECT 1 FROM audit.red
             WHERE ${servicio} AND comando->>'evento_id' = $1 AND (comando->>'sesion_id')::bigint = $2
               AND (ok OR (respuesta->>'final')::boolean)
             LIMIT 1`,
            servicioId === null ? [eventoId, sesionId] : [eventoId, sesionId, servicioId],
        )
        return (rowCount ?? 0) > 0
    }

    async registrar(
        fila: FilaRed,
        fallido?: { payload: CoaFallido; requestId: string | null },
    ): Promise<void> {
        const cliente = await this.pool.connect()
        try {
            await cliente.query('BEGIN')
            await cliente.query(
                `INSERT INTO audit.red (tipo, router_id, servicio_id, comando, respuesta, ok)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [fila.tipo, fila.router_id, fila.servicio_id, fila.comando, fila.respuesta, fila.ok],
            )
            if (fallido) {
                await cliente.query(
                    `INSERT INTO audit.outbox (evento, payload, request_id) VALUES ('coa.fallido', $1, $2)`,
                    [fallido.payload, fallido.requestId],
                )
            }
            await cliente.query('COMMIT')
        } catch (e) {
            await cliente.query('ROLLBACK').catch(() => {})
            throw e
        } finally {
            cliente.release()
        }
    }

    async cerrar(): Promise<void> {
        await this.pool.end()
    }
}
