import { Queue, Worker } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import ProgramarRecordatorios, { LIMITE_LOTE } from '#notify/actions/programar_recordatorios'
import { conexionRedis, prefijoColas, type ColaEnvios, type OpcionesCola } from '#notify/cola'
import { ID_PARTICIONES, ejecutarParticiones } from '#notify/particiones'

/**
 * Cron de recordatorios de pago. Un job scheduler de BullMQ (`notify-cron`, id `recordatorios`)
 * dispara cada minuto; el worker tiene concurrencia 1 y BullMQ entrega cada disparo a un solo
 * worker, así que aunque haya varias instancias corre una a la vez. Cada disparo programa todo
 * lo pendiente hasta ese momento (`ProgramarRecordatorios`), en lotes.
 */

export const NOMBRE_COLA_CRON = 'notify-cron'
export const ID_RECORDATORIOS = 'recordatorios'
export const CADA_MS = 60_000

export interface TotalesRecordatorios {
    lotes: number
    procesadas: number
    nuevos: number
    errores: number
}

/** Corre lotes de `ProgramarRecordatorios` hasta agotar lo pendiente y encola los envíos. */
export async function ejecutarRecordatorios(
    cola: ColaEnvios,
    opciones: { ahora?: string; limite?: number; ventanaDias?: number; maxLotes?: number } = {},
): Promise<TotalesRecordatorios> {
    const limite = opciones.limite ?? LIMITE_LOTE
    const totales: TotalesRecordatorios = { lotes: 0, procesadas: 0, nuevos: 0, errores: 0 }
    const ahora = opciones.ahora ?? new Date().toISOString()

    for (let lote = 0; lote < (opciones.maxLotes ?? 50); lote++) {
        const resultado = await new ProgramarRecordatorios().execute(
            { ahora, limite, ventanaDias: opciones.ventanaDias },
            contextoSistema('cron'),
        )
        await cola.encolar(resultado.encolar)
        totales.lotes++
        totales.procesadas += resultado.procesadas
        totales.nuevos += resultado.nuevos
        totales.errores += resultado.errores
        // Lote incompleto: no queda nada. Lote sin envíos nuevos: no avanzar en falso (errores).
        if (resultado.procesadas < limite || resultado.nuevos === 0) break
    }
    return totales
}

/** Registra el disparo periódico (idempotente: `upsertJobScheduler`). */
export async function programarCronRecordatorios(opciones: OpcionesCola & { cadaMs?: number } = {}) {
    const cola = new Queue(NOMBRE_COLA_CRON, {
        connection: opciones.conexion ?? conexionRedis(),
        prefix: opciones.prefijo ?? prefijoColas(),
    })
    await cola.upsertJobScheduler(
        ID_RECORDATORIOS,
        { every: opciones.cadaMs ?? CADA_MS },
        { name: ID_RECORDATORIOS, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    )
    return cola
}

export function crearWorkerCron(colaEnvios: ColaEnvios, opciones: OpcionesCola = {}) {
    const worker = new Worker(
        NOMBRE_COLA_CRON,
        async (job) => {
            if (job.name === ID_PARTICIONES) {
                const resultado = await ejecutarParticiones()
                logger.info(resultado, 'Particiones de auditoría aseguradas')
                return resultado
            }
            if (job.name !== ID_RECORDATORIOS) return null
            const totales = await ejecutarRecordatorios(colaEnvios)
            if (totales.procesadas > 0) logger.info(totales, 'Recordatorios programados')
            return totales
        },
        {
            connection: opciones.conexion ?? conexionRedis(),
            prefix: opciones.prefijo ?? prefijoColas(),
            concurrency: 1,
        },
    )
    worker.on('failed', (job, error) => logger.error({ err: error, cron: job?.name }, 'Cron de notify falló'))
    worker.on('error', (error) => logger.error({ err: error }, 'Worker del cron de notify'))
    return worker
}
