import type { Queue } from 'bullmq'
import { contextoSistema } from '#shared/contexto'
import RecalcularAlmacenamiento, { PRESUPUESTO_CRON_MS } from '#monitoreo/actions/recalcular_almacenamiento'
import type { Medicion } from '#monitoreo/almacenamiento'

/**
 * Cron diario del almacenamiento (contrato `salud.md` §6). Vive en la cola de crons de notify
 * (`notify-cron`, `notify:worker`) con el id `almacenamiento`, como las particiones: BullMQ lo
 * dispara una sola vez por patrón y la acción toma además un advisory lock (el botón y el cron no
 * se pisan). Minuto 23 de las 04 UTC (22:23 en Guatemala), fuera de la hora en punto.
 */
export const ID_ALMACENAMIENTO = 'almacenamiento'
export const PATRON_ALMACENAMIENTO = '23 4 * * *'

export async function ejecutarAlmacenamiento(): Promise<Medicion> {
    return new RecalcularAlmacenamiento().execute(
        { origen: 'cron', presupuesto_ms: PRESUPUESTO_CRON_MS },
        contextoSistema('cron'),
    )
}

export async function programarCronAlmacenamiento(
    cola: Queue,
    patron = PATRON_ALMACENAMIENTO,
): Promise<void> {
    await cola.upsertJobScheduler(
        ID_ALMACENAMIENTO,
        { pattern: patron, tz: 'UTC' },
        { name: ID_ALMACENAMIENTO, opts: { removeOnComplete: 24, removeOnFail: 100 } },
    )
}
