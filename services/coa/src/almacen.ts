import pg from 'pg'
import type { EstadoServicio, ServicioActual } from './decision.ts'
import type { TipoPaquete } from './nas.ts'

/**
 * Lo que `coa` lee y escribe en Postgres. `coa` no pasa por `apps/api`: lee el estado vigente del
 * servicio y las sesiones abiertas (`network.sesiones`, las escribe `sesiones:worker`), y escribe
 * `audit.red` (cada envío con su respuesta) y, al agotar reintentos, `coa.fallido` en
 * `audit.outbox` en la MISMA transacción que la fila de `audit.red` del último intento.
 */

export interface SesionActiva {
    id: number
    nas_ip: string
    acct_session_id: string
    user_ppp: string
    router_id: number | null
    /** `network.routers.radius_secret` cifrado (v1) o null si el NAS no está dado de alta */
    radius_secret: string | null
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

    constructor(config: pg.PoolConfig) {
        this.pool = new pg.Pool({ max: 5, ...config })
        this.pool.on('error', () => {
            // Una conexión inactiva que se cae no debe tumbar el proceso; la siguiente consulta reconecta.
        })
    }

    async servicio(servicioId: number): Promise<ServicioActual | null> {
        const { rows } = await this.pool.query<{
            estado: EstadoServicio
            subida_kbps: number
            bajada_kbps: number
            subida_limitada_kbps: number
            bajada_limitada_kbps: number
            rate_limit_override: string | null
        }>(
            `SELECT s.estado, p.subida_kbps, p.bajada_kbps, p.subida_limitada_kbps, p.bajada_limitada_kbps,
                    pr.rate_limit_override
             FROM core.servicios s
             JOIN network.planes p ON p.id = s.plan_id
             LEFT JOIN network.planes_routers pr ON pr.plan_id = s.plan_id AND pr.router_id = s.router_id
             WHERE s.id = $1`,
            [servicioId],
        )
        const fila = rows[0]
        return fila ? { servicio_id: servicioId, ...fila } : null
    }

    async sesionesActivas(servicioId: number): Promise<SesionActiva[]> {
        const { rows } = await this.pool.query<SesionActiva>(
            `SELECT ses.id::int AS id, host(ses.nas_ip) AS nas_ip, ses.acct_session_id, ses.user_ppp,
                    r.id::int AS router_id, r.radius_secret
             FROM network.sesiones ses
             LEFT JOIN network.routers r ON r.nas_ip = ses.nas_ip
             WHERE ses.servicio_id = $1 AND ses.fin IS NULL
             ORDER BY ses.inicio`,
            [servicioId],
        )
        return rows
    }

    async sesionAbierta(sesionId: number): Promise<SesionPorId | null> {
        const { rows } = await this.pool.query<SesionPorId>(
            `SELECT ses.id::int AS id, ses.servicio_id::int AS servicio_id, host(ses.nas_ip) AS nas_ip,
                    ses.acct_session_id, ses.user_ppp, r.id::int AS router_id, r.radius_secret
             FROM network.sesiones ses
             LEFT JOIN network.routers r ON r.nas_ip = ses.nas_ip
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
