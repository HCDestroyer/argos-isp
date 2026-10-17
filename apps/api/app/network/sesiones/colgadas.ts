import { Queue, Worker, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import CerrarSesionesColgadas from '#network/sesiones/actions/cerrar_sesiones_colgadas'

/**
 * Cron de sesiones colgadas (`node ace sesiones:worker`, cola `sesiones-cron`, job
 * `cerrar_colgadas` cada `SESIONES_COLGADAS_CADA_MS`).
 *
 * - Umbral: `SESIONES_COLGADAS_INTERVALOS` (3) × `AAA_INTERIM_SEGUNDOS` (300) = 15 min sin Stop ni
 *   Interim-Update. `AAA_INTERIM_SEGUNDOS` debe ser el mismo que el de `services/aaa`.
 * - Procesa todo lo pendiente hasta ahora, por lotes de `LOTE` (una transacción y una fila de
 *   auditoría por lote), no "lo de esta corrida".
 * - Lock: worker con concurrencia 1 y advisory lock de Postgres durante la corrida; si otra réplica
 *   del worker lo tiene, la corrida se omite.
 */

export const NOMBRE_COLA_SESIONES_CRON = 'sesiones-cron'
export const JOB_CERRAR_COLGADAS = 'cerrar_colgadas'
const LOCK_CRON_SESIONES = 4104
const LOTE = 500

export function configColgadas() {
    const intervalos = env.get('SESIONES_COLGADAS_INTERVALOS') ?? 3
    const interim = env.get('AAA_INTERIM_SEGUNDOS') ?? 300
    return {
        umbralS: Math.max(1, intervalos) * Math.max(1, interim),
        cadaMs: env.get('SESIONES_COLGADAS_CADA_MS') ?? 300_000,
    }
}

export interface ResultadoCorridaColgadas {
    omitido: boolean
    cerradas: number[]
    nas_silenciosos: string[]
    lotes: number
}

/** Una corrida: cierra por lotes todas las colgadas hasta `ahora`. La usan el worker y las pruebas. */
export async function ejecutarCierreColgadas(
    opciones: { ahora?: Date; umbralS?: number; lote?: number } = {},
): Promise<ResultadoCorridaColgadas> {
    const ahora = opciones.ahora ?? new Date()
    const umbralS = opciones.umbralS ?? configColgadas().umbralS
    const lote = opciones.lote ?? LOTE
    const ctx = contextoSistema('cron', `sesiones-colgadas-${ahora.toISOString()}`)

    // El lock vive en una conexión aparte durante toda la corrida (cada lote es su transacción).
    return db.transaction(async (trx) => {
        const { rows } = (await trx.rawQuery('SELECT pg_try_advisory_xact_lock(?, hashtext(?)) AS ok', [
            LOCK_CRON_SESIONES,
            JOB_CERRAR_COLGADAS,
        ])) as { rows: Array<{ ok: boolean }> }
        if (!rows[0]?.ok) return { omitido: true, cerradas: [], nas_silenciosos: [], lotes: 0 }

        const cerradas: number[] = []
        let silenciosos: string[] = []
        let lotes = 0
        for (;;) {
            const r = await new CerrarSesionesColgadas().execute(
                { ahora: ahora.toISOString(), umbral_s: umbralS, limite: lote },
                ctx,
            )
            lotes++
            cerradas.push(...r.cerradas)
            silenciosos = r.nas_silenciosos
            if (r.cerradas.length < lote) break
        }
        if (cerradas.length > 0 || silenciosos.length > 0) {
            logger.info(
                { cerradas: cerradas.length, nas_silenciosos: silenciosos, umbral_s: umbralS },
                'Sesiones colgadas',
            )
        }
        return { omitido: false, cerradas, nas_silenciosos: silenciosos, lotes }
    })
}

function conexion(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: null,
    }
}

function prefijo(p?: string) {
    return p ?? env.get('COLAS_PREFIJO') ?? 'argosisp'
}

/** Programa (o reprograma) el job repetible. Con `cadaMs` 0 lo quita. */
export async function programarCronSesiones(
    opciones: { prefijo?: string; cadaMs?: number } = {},
): Promise<Queue> {
    const cola = new Queue(NOMBRE_COLA_SESIONES_CRON, {
        connection: conexion(),
        prefix: prefijo(opciones.prefijo),
    })
    const cada = opciones.cadaMs ?? configColgadas().cadaMs
    if (cada <= 0) {
        await cola.removeJobScheduler(JOB_CERRAR_COLGADAS)
        return cola
    }
    await cola.upsertJobScheduler(
        JOB_CERRAR_COLGADAS,
        { every: cada },
        {
            name: JOB_CERRAR_COLGADAS,
            data: {},
            opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
        },
    )
    return cola
}

export function crearWorkerCronSesiones(opciones: { prefijo?: string } = {}) {
    const worker = new Worker(
        NOMBRE_COLA_SESIONES_CRON,
        async (job) => {
            if (job.name !== JOB_CERRAR_COLGADAS) throw new Error(`Cron de sesiones desconocido: ${job.name}`)
            return ejecutarCierreColgadas()
        },
        { connection: conexion(), prefix: prefijo(opciones.prefijo), concurrency: 1 },
    )
    worker.on('failed', (job, error) =>
        logger.error({ cron: job?.name, err: error }, 'Cron de sesiones falló'),
    )
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de cron de sesiones'))
    return worker
}
