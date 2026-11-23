import { Queue } from 'bullmq'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { RedisOptions } from 'bullmq'
import env from '#start/env'
import { redis } from '#shared/redis'
import type { CronCatalogo } from '#monitoreo/crons/catalogo'

/**
 * Quién tiene ahora el lock de un cron, sin tomarlo nunca (tomarlo para mirar haría que la corrida
 * real se omitiera):
 *
 * - `postgres`: `pg_locks` (advisory locks concedidos). Con dos claves, `classid` = espacio y `objid` =
 *   `hashtext(nombre)` sin signo (`objsubid` 2); con una sola clave bigint, alto y bajo de 32 bits
 *   (`objsubid` 1). Devuelve el pid del backend que lo tiene.
 * - `redis`: el valor de `<COLAS_PREFIJO>:lock:<sufijo>` (dueño aleatorio del relay o del vigía).
 * - `cola`: un job activo con ese nombre en su cola de BullMQ.
 */

export interface EstadoLock {
    tipo: 'postgres' | 'redis' | 'cola'
    tomado: boolean
    /** pid de Postgres, dueño del lock de Redis o id del job activo */
    dueno: string | null
}

// Sin importar `#notify/cola` (lo importan los workers de los módulos vía `corridas.ts`: evita ciclos).
function conexionRedis(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: null,
    }
}

function prefijoColas(): string {
    return env.get('COLAS_PREFIJO') ?? 'argosisp'
}

let colas: Map<string, Queue> | undefined

/** Colas de los crons (una conexión por cola y proceso; se cierran al terminar la app). */
export function colaCron(nombre: string): Queue {
    if (!colas) {
        colas = new Map()
        app.terminating(async () => {
            await cerrarColasCrons()
        })
    }
    const clave = `${prefijoColas()}|${nombre}`
    let cola = colas.get(clave)
    if (!cola) {
        cola = new Queue(nombre, { connection: conexionRedis(), prefix: prefijoColas() })
        colas.set(clave, cola)
    }
    return cola
}

export async function cerrarColasCrons(): Promise<void> {
    const abiertas = [...(colas?.values() ?? [])]
    colas?.clear()
    await Promise.all(abiertas.map((c) => c.close()))
}

export async function estadoLock(cron: CronCatalogo): Promise<EstadoLock | null> {
    const lock = cron.lock
    if (!lock) return null
    if (lock.tipo === 'postgres') {
        const { rows } = (await db.rawQuery(
            lock.espacio === null
                ? `SELECT pid FROM pg_locks
                   WHERE locktype = 'advisory' AND granted AND objsubid = 1
                     AND classid = ((hashtext(?)::bigint >> 32) & 4294967295)::oid
                     AND objid = (hashtext(?)::bigint & 4294967295)::oid
                   LIMIT 1`
                : `SELECT pid FROM pg_locks
                   WHERE locktype = 'advisory' AND granted AND objsubid = 2
                     AND classid = ?::bigint::oid
                     AND objid = (hashtext(?)::bigint & 4294967295)::oid
                   LIMIT 1`,
            lock.espacio === null ? [lock.nombre, lock.nombre] : [lock.espacio, lock.nombre],
        )) as { rows: Array<{ pid: number }> }
        const pid = rows[0]?.pid
        return { tipo: 'postgres', tomado: pid !== undefined, dueno: pid !== undefined ? String(pid) : null }
    }
    if (lock.tipo === 'redis') {
        const dueno = await redis().get(`${prefijoColas()}:lock:${lock.sufijo}`)
        return { tipo: 'redis', tomado: dueno !== null, dueno }
    }
    if (!cron.bullmq) return null
    const activos = await colaCron(cron.bullmq.cola).getActive()
    const job = activos.find((j) => j.name === cron.bullmq!.job)
    return { tipo: 'cola', tomado: job !== undefined, dueno: job?.id ?? null }
}
