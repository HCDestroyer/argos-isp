import { Queue, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import { conLock, conexionRedisBilling } from '#billing/jobs'
import { procesarColaFel } from '#fiscal/fel/cola'
import GenerarCalendario from '#fiscal/actions/generar_calendario'
import EmitirAlertasFiscales from '#fiscal/actions/emitir_alertas_fiscales'

/**
 * Cola `fel-cron` del worker `node ace fiscal:worker` (contrato §8.3): un job scheduler `fel`
 * cada minuto que procesa la cola FEL completa (`procesarColaFel`) con el advisory lock de los
 * crons (una sola instancia). Las esperas de los reintentos las decide cada DTE
 * (`proximo_intento`), no BullMQ: si el worker se cae, la siguiente corrida retoma todo lo vencido.
 *
 * Fase 7 PR A: en la misma cola, el job `calendario` (cron `fiscal:calendario`, cada hora y al
 * arrancar) genera y concilia el calendario fiscal de todas las empresas y emite las alertas de
 * vencimiento y del límite del pequeño contribuyente, con su propio lock. Procesa todo lo pendiente
 * hasta ahora: si el worker estuvo detenido, la primera corrida lo pone al día.
 */

export const NOMBRE_COLA_FEL = 'fel-cron'
export const CADA_FEL_MS = 60_000
export const CADA_CALENDARIO_MS = 3_600_000

interface OpcionesColaFel {
    conexion?: RedisOptions
    prefijo?: string
}

function prefijo(opciones: OpcionesColaFel) {
    return opciones.prefijo ?? env.get('COLAS_PREFIJO') ?? 'argosisp'
}

export async function programarColaFel(opciones: OpcionesColaFel = {}) {
    const cola = new Queue(NOMBRE_COLA_FEL, {
        connection: opciones.conexion ?? conexionRedisBilling(),
        prefix: prefijo(opciones),
    })
    await cola.upsertJobScheduler(
        'fel',
        { every: CADA_FEL_MS },
        { name: 'fel', data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
    )
    await cola.upsertJobScheduler(
        'calendario',
        { every: CADA_CALENDARIO_MS, immediately: true },
        {
            name: 'calendario',
            data: {},
            opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
        },
    )
    return cola
}

/**
 * Cron `fiscal:calendario`: genera el calendario y emite sus alertas (dos acciones, cada una con su
 * transacción y su auditoría), bajo un lock: una sola instancia a la vez.
 */
export async function ejecutarCalendarioFiscal(ahora: Date = new Date(), opciones: { hoy?: string } = {}) {
    const ctx = contextoSistema('cron', `fiscal-calendario-${ahora.toISOString()}`)
    return conLock('fiscal:calendario', async () => {
        const calendario = await new GenerarCalendario().execute({ hoy: opciones.hoy }, ctx)
        const alertas = await new EmitirAlertasFiscales().execute({ hoy: opciones.hoy }, ctx)
        return { calendario, alertas }
    })
}

export async function ejecutarColaFel(ahora: Date = new Date()) {
    const ctx = contextoSistema('cron', `fel-${ahora.toISOString()}`)
    return conLock('fel', () => procesarColaFel(ctx))
}

export function crearWorkerFel(opciones: OpcionesColaFel = {}) {
    const worker = new Worker(
        NOMBRE_COLA_FEL,
        (job: Job) => (job.name === 'calendario' ? ejecutarCalendarioFiscal() : ejecutarColaFel()),
        {
            connection: opciones.conexion ?? conexionRedisBilling(),
            prefix: prefijo(opciones),
            concurrency: 1,
        },
    )
    worker.on('completed', (job, salida) => logger.debug({ job: job.name, salida }, 'Cola FEL procesada'))
    worker.on('failed', (job, error) => logger.error({ job: job?.name, err: error }, 'Cola FEL falló'))
    worker.on('error', (error) => logger.error({ err: error }, 'Worker FEL'))
    return worker
}
