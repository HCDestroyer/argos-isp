import { Queue, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import { planesTemporalesPendientes } from '#core/planes_temporales'
import IniciarPlanTemporal from '#core/actions/iniciar_plan_temporal'
import TerminarPlanTemporal from '#core/actions/terminar_plan_temporal'

/**
 * Crons del núcleo (A1) con BullMQ. Los atiende `node ace eventos:relay` (proceso de A1 que ya
 * corre en cada instalación); `--sin-crons` los apaga en ese proceso.
 *
 * | Job | Cada | Qué hace |
 * | --- | --- | --- |
 * | `planes_temporales` | 1 min | Termina los planes temporales activos con `fin ≤ ahora` y luego inicia los programados con `inicio ≤ ahora` (todo lo pendiente hasta ahora, nunca "los de hoy") |
 *
 * Lock: el worker tiene concurrencia 1 y el job toma un advisory lock de Postgres
 * (`pg_try_advisory_xact_lock`) mientras corre; si otra instancia lo tiene, el disparo se omite.
 * Idempotencia: cada plan temporal es su propia clave (`plan_temporal:<id>` + su estado): la acción
 * solo actúa si la fila sigue `programado`/`activo`, así repetir la corrida no duplica eventos.
 * Cada plan va en su propia transacción: uno que falla queda auditado y no frena a los demás.
 */

export const NOMBRE_COLA_CORE = 'core-cron'

export const CRONS_CORE = {
    planes_temporales: 60_000,
} as const
export type NombreCronCore = keyof typeof CRONS_CORE

export interface OpcionesColaCore {
    conexion?: RedisOptions
    /** prefijo de claves en Redis; las pruebas usan uno propio */
    prefijo?: string
}

function conexionRedis(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: null,
    }
}

function prefijo(opciones: OpcionesColaCore) {
    return opciones.prefijo ?? env.get('COLAS_PREFIJO') ?? 'argosisp'
}

/** Registra (o actualiza) los job schedulers del núcleo. Devuelve la cola para cerrarla al salir. */
export async function programarCronsCore(opciones: OpcionesColaCore = {}): Promise<Queue> {
    const cola = new Queue(NOMBRE_COLA_CORE, {
        connection: opciones.conexion ?? conexionRedis(),
        prefix: prefijo(opciones),
    })
    for (const [nombre, cada] of Object.entries(CRONS_CORE)) {
        await cola.upsertJobScheduler(
            nombre,
            { every: cada },
            {
                name: nombre,
                data: {},
                opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
            },
        )
    }
    return cola
}

/** Espacio de los advisory locks de los crons del núcleo. */
const LOCK_CRON_CORE = 4001

async function conLock<T>(
    nombre: string,
    trabajo: () => Promise<T>,
): Promise<{ omitido: boolean; resultado?: T }> {
    return db.transaction(async (trx) => {
        const { rows } = (await trx.rawQuery('SELECT pg_try_advisory_xact_lock(?, hashtext(?)) AS ok', [
            LOCK_CRON_CORE,
            nombre,
        ])) as { rows: Array<{ ok: boolean }> }
        if (!rows[0]?.ok) return { omitido: true }
        return { omitido: false, resultado: await trabajo() }
    })
}

export interface ResultadoPlanesTemporales {
    terminados: number[]
    iniciados: number[]
    fallidos: number[]
}

/**
 * Procesa los planes temporales pendientes hasta `ahora`: primero termina (el servicio vuelve a su
 * plan base) y después inicia. Solo llama acciones (regla 1).
 */
export async function procesarPlanesTemporales(ahora: Date = new Date()): Promise<ResultadoPlanesTemporales> {
    const ctx = contextoSistema('cron', `core-planes_temporales-${ahora.toISOString()}`)
    const { porTerminar, porIniciar } = await planesTemporalesPendientes(ahora)
    const resultado: ResultadoPlanesTemporales = { terminados: [], iniciados: [], fallidos: [] }
    for (const id of porTerminar) {
        try {
            const salida = await new TerminarPlanTemporal().execute({ id, ahora }, ctx)
            if (salida.estado === 'terminado') resultado.terminados.push(id)
        } catch (error) {
            resultado.fallidos.push(id)
            logger.error({ err: error, plan_temporal_id: id }, 'No se pudo terminar el plan temporal')
        }
    }
    for (const id of porIniciar) {
        try {
            const salida = await new IniciarPlanTemporal().execute({ id, ahora }, ctx)
            if (salida.estado === 'activo') resultado.iniciados.push(id)
        } catch (error) {
            resultado.fallidos.push(id)
            logger.error({ err: error, plan_temporal_id: id }, 'No se pudo iniciar el plan temporal')
        }
    }
    return resultado
}

/** Ejecuta un cron del núcleo por nombre con su lock (lo usa el worker; las pruebas lo llaman directo). */
export async function ejecutarCronCore(nombre: string, ahora: Date = new Date()) {
    switch (nombre) {
        case 'planes_temporales':
            return conLock(nombre, () => procesarPlanesTemporales(ahora))
        default:
            throw new Error(`Cron del núcleo desconocido: ${nombre}`)
    }
}

export function crearWorkerCore(opciones: OpcionesColaCore = {}) {
    const worker = new Worker(NOMBRE_COLA_CORE, (job: Job) => ejecutarCronCore(job.name), {
        connection: opciones.conexion ?? conexionRedis(),
        prefix: prefijo(opciones),
        concurrency: 1,
    })
    worker.on('completed', (job, salida) =>
        logger.debug({ cron: job.name, salida }, 'Cron del núcleo terminado'),
    )
    worker.on('failed', (job, error) =>
        logger.error({ cron: job?.name, err: error }, 'Cron del núcleo falló'),
    )
    worker.on('error', (error) => logger.error({ err: error }, 'Worker del núcleo'))
    return worker
}
