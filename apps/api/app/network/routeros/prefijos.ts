import { Queue, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import CompletarPrefijoDelegado, {
    type ResultadoCompletarPrefijo,
} from '#network/sesiones/actions/completar_prefijo_delegado'
import type { OpcionesDispatcher } from '#network/routeros/dispatcher'

/**
 * Cola `routeros-prefijos` (modo `radius_pool` de IPv6): tras cada `sesion.iniciada` sin prefijo
 * delegado, un job con retraso pregunta al router qué /56 delegó (`CompletarPrefijoDelegado`). El
 * DHCPv6-PD ocurre segundos después del Start, así que el primer intento va a los 5 s y los
 * siguientes con backoff (5 · 10 · 20 · 40 · 80 s). `jobId` = la sesión (`nas_ip` +
 * `acct_session_id`): un evento repetido no encola dos veces. Lo corre `node ace routeros:worker`.
 */

export const NOMBRE_COLA_PREFIJOS = 'routeros-prefijos'
const INTENTOS = 6
const RETRASO_MS = 5000

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

let cola: Queue | null = null

export interface DatosPrefijo {
    nas_ip: string
    acct_session_id: string
}

export async function encolarPrefijo(
    datos: DatosPrefijo,
    opciones: { retrasoMs?: number } = {},
): Promise<void> {
    cola ??= new Queue(NOMBRE_COLA_PREFIJOS, { connection: conexion(), prefix: prefijo() })
    await cola.add('completar', datos, {
        // Sin `:` (BullMQ no lo admite en ids propios): la sesión en base64url.
        jobId: `sesion-${Buffer.from(`${datos.nas_ip}|${datos.acct_session_id}`).toString('base64url')}`,
        delay: opciones.retrasoMs ?? RETRASO_MS,
        attempts: INTENTOS,
        backoff: { type: 'exponential', delay: RETRASO_MS },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
    })
}

export async function cerrarColaPrefijos(): Promise<void> {
    await cola?.close()
    cola = null
}

/** Un intento. Lanza si conviene reintentar (sin binding todavía o router sin responder). */
export async function procesarPrefijo(
    datos: DatosPrefijo,
    opciones: OpcionesDispatcher = {},
): Promise<ResultadoCompletarPrefijo> {
    const salida = await new CompletarPrefijoDelegado(opciones).execute(
        { nas_ip: datos.nas_ip, acct_session_id: datos.acct_session_id },
        contextoSistema('worker', `prefijo-${datos.nas_ip}-${datos.acct_session_id}`),
    )
    if (salida.estado === 'sin_binding' || salida.estado === 'error') {
        throw new Error(
            `sesión ${datos.acct_session_id}@${datos.nas_ip}: ${salida.estado}${salida.error ? ` (${salida.error})` : ''}`,
        )
    }
    return salida
}

export function crearWorkerPrefijos(opciones: { prefijo?: string } = {}) {
    const worker = new Worker(NOMBRE_COLA_PREFIJOS, (job: Job<DatosPrefijo>) => procesarPrefijo(job.data), {
        connection: conexion(),
        prefix: prefijo(opciones.prefijo),
        concurrency: 4,
    })
    worker.on('failed', (job, error) => {
        if (job && job.attemptsMade >= INTENTOS) {
            logger.warn({ ...job.data, err: error }, 'Prefijo delegado no encontrado en el router')
        }
    })
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de prefijos'))
    return worker
}
