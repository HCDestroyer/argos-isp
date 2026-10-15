import { Queue, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import EnviarNotificacion, { type ResultadoEnviar } from '#notify/actions/enviar_notificacion'

/**
 * Cola BullMQ de envíos (`notify-envios`). Cada job es `{ envioId }` con `jobId = envio-<id>`:
 * encolar dos veces el mismo envío no duplica el job. Reintentos con backoff exponencial; el
 * último intento marca el envío `fallido` (ver `EnviarNotificacion`).
 */

export const NOMBRE_COLA_ENVIOS = 'notify-envios'

/** Lo que necesitan el consumidor de eventos y el worker para encolar envíos. */
export interface ColaEnvios {
    encolar(envioIds: number[]): Promise<void>
}

export interface OpcionesCola {
    conexion?: RedisOptions
    /** prefijo de claves en Redis; las pruebas usan uno propio */
    prefijo?: string
    /** intentos por envío (por defecto `NOTIFY_INTENTOS` o 5) */
    intentos?: number
    /** espera base del backoff exponencial en ms (por defecto 5000) */
    esperaMs?: number
}

export function conexionRedis(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        // requerido por BullMQ para las conexiones bloqueantes de los workers
        maxRetriesPerRequest: null,
    }
}

export function prefijoColas(): string {
    return env.get('COLAS_PREFIJO') ?? 'argosisp'
}

export class ColaEnviosBullmq implements ColaEnvios {
    readonly cola: Queue
    readonly #intentos: number
    readonly #esperaMs: number

    constructor(opciones: OpcionesCola = {}) {
        this.cola = new Queue(NOMBRE_COLA_ENVIOS, {
            connection: opciones.conexion ?? conexionRedis(),
            prefix: opciones.prefijo ?? prefijoColas(),
        })
        this.#intentos = opciones.intentos ?? env.get('NOTIFY_INTENTOS') ?? 5
        this.#esperaMs = opciones.esperaMs ?? 5000
    }

    async encolar(envioIds: number[]): Promise<void> {
        if (envioIds.length === 0) return
        await this.cola.addBulk(
            envioIds.map((envioId) => ({
                name: 'enviar',
                data: { envioId },
                opts: {
                    jobId: `envio-${envioId}`,
                    attempts: this.#intentos,
                    backoff: { type: 'exponential', delay: this.#esperaMs },
                    removeOnComplete: { age: 24 * 3600, count: 10_000 },
                    removeOnFail: { age: 7 * 24 * 3600 },
                },
            })),
        )
    }

    async cerrar() {
        await this.cola.close()
    }
}

/** Procesa un job de envío: llama a la acción y traduce su resultado para BullMQ. */
export async function procesarEnvio(
    job: Job<{ envioId: number }>,
    cola: ColaEnvios,
): Promise<ResultadoEnviar> {
    const resultado = await new EnviarNotificacion().execute(
        {
            envioId: job.data.envioId,
            intento: job.attemptsMade + 1,
            maxIntentos: job.opts.attempts ?? 1,
        },
        contextoSistema('worker', `notify-envio-${job.data.envioId}-${job.attemptsMade + 1}`),
    )
    if (resultado.fallbackId) await cola.encolar([resultado.fallbackId])
    // Lanzar hace que BullMQ reintente con backoff; el estado ya quedó registrado en notify.envios.
    if (resultado.estado === 'reintentar') throw new Error(resultado.error ?? 'reintentar')
    return resultado
}

export function crearWorkerEnvios(cola: ColaEnvios, opciones: OpcionesCola & { concurrencia?: number } = {}) {
    const worker = new Worker<{ envioId: number }, ResultadoEnviar>(
        NOMBRE_COLA_ENVIOS,
        (job) => procesarEnvio(job, cola),
        {
            connection: opciones.conexion ?? conexionRedis(),
            prefix: opciones.prefijo ?? prefijoColas(),
            concurrency: opciones.concurrencia ?? 5,
        },
    )
    worker.on('failed', (job, error) => {
        logger.warn(
            { envioId: job?.data.envioId, intento: job?.attemptsMade, err: error },
            'Envío no entregado',
        )
    })
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de notificaciones'))
    return worker
}
