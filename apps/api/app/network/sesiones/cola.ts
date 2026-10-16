import { UnrecoverableError, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import {
    NOMBRE_COLA_ACCOUNTING,
    parsearRegistro,
    RegistroInvalido,
    type RegistroAccounting,
} from '#network/sesiones/registro'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import ActualizarSesion from '#network/sesiones/actions/actualizar_sesion'
import TerminarSesion from '#network/sesiones/actions/terminar_sesion'
import CerrarSesionesNas from '#network/sesiones/actions/cerrar_sesiones_nas'

/**
 * Worker de la cola `aaa-accounting` (la llena `services/aaa`). Cada job es un paquete de
 * accounting ya normalizado; aquí solo se valida y se llama a la acción que corresponde.
 * Un job inválido no se reintenta (`UnrecoverableError`); un error de Postgres sí (backoff del job).
 */

/** Misma conexión y prefijo que el resto de colas de la API (`COLAS_PREFIJO`, igual que `aaa`). */
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

export async function procesarAccounting(registro: RegistroAccounting, requestId: string) {
    const ctx = contextoSistema('worker', requestId)
    switch (registro.tipo) {
        case 'Start':
            return new IniciarSesion().execute(registro, ctx)
        case 'Interim-Update':
            return new ActualizarSesion().execute(registro, ctx)
        case 'Stop':
            return new TerminarSesion().execute(registro, ctx)
        case 'Accounting-On':
        case 'Accounting-Off':
            return new CerrarSesionesNas().execute(registro, ctx)
    }
}

const ID_VALIDO = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * `request_id` del job: el que puso `aaa` (estable por sesión PPPoE, `services/aaa/src/request_id.ts`)
 * para que `audit.*` y los eventos de la sesión se encuentren con el mismo id que los logs de `aaa`.
 * Jobs sin él (o con uno inválido): `accounting-<job>-<intento>`, como antes.
 */
export function requestIdDelJob(job: Pick<Job<unknown>, 'id' | 'data' | 'attemptsMade'>): string {
    const dato = job.data
    const id =
        typeof dato === 'object' && dato !== null ? (dato as { request_id?: unknown }).request_id : undefined
    if (typeof id === 'string' && ID_VALIDO.test(id)) return id
    return `accounting-${job.id}-${job.attemptsMade + 1}`
}

async function procesarJob(job: Job<unknown>) {
    let registro: RegistroAccounting
    try {
        registro = parsearRegistro(job.data)
    } catch (error) {
        if (error instanceof RegistroInvalido) throw new UnrecoverableError(error.message)
        throw error
    }
    return procesarAccounting(registro, requestIdDelJob(job))
}

export interface OpcionesWorkerAccounting {
    conexion?: RedisOptions
    prefijo?: string
    /** jobs en paralelo; las acciones toleran desorden y concurrencia sobre la misma sesión */
    concurrencia?: number
}

export function crearWorkerAccounting(opciones: OpcionesWorkerAccounting = {}) {
    const worker = new Worker(NOMBRE_COLA_ACCOUNTING, procesarJob, {
        connection: opciones.conexion ?? conexionRedis(),
        prefix: opciones.prefijo ?? prefijoColas(),
        concurrency: opciones.concurrencia ?? 4,
    })
    worker.on('failed', (job, error) => {
        logger.warn(
            { jobId: job?.id, tipo: job?.name, intento: job?.attemptsMade, err: error },
            'Accounting no procesado',
        )
    })
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de accounting'))
    return worker
}
