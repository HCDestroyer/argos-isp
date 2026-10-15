import type { Queue } from 'bullmq'
import { contextoSistema } from '#shared/contexto'
import CrearParticionesAuditoria, {
    MESES_PARTICIONES,
    type ResultadoParticiones,
} from '#notify/actions/crear_particiones_auditoria'

/**
 * Cron mensual de particiones de `audit` (pedido del Líder BE). Vive en la cola de crons de
 * notify (`notify-cron`, la misma de los recordatorios) con el id `particiones`: el día 1 de cada
 * mes a las 06:07 UTC asegura el mes actual y los 12 siguientes. Además se encola una vez al
 * arrancar `notify:worker`, así un despliegue que se saltó el día 1 no espera un mes. La acción
 * es idempotente, correrla de más no cuesta nada.
 */

export const ID_PARTICIONES = 'particiones'
/** minuto 7 para no caer en la hora en punto (todos los crons del mundo corren a :00) */
export const PATRON_PARTICIONES = '7 6 1 * *'

export async function ejecutarParticiones(
    opciones: { desde?: string; meses?: number } = {},
): Promise<ResultadoParticiones> {
    return new CrearParticionesAuditoria().execute(
        { desde: opciones.desde, meses: opciones.meses ?? MESES_PARTICIONES },
        contextoSistema('cron'),
    )
}

/** Registra el disparo mensual (idempotente) y encola una ejecución inmediata. */
export async function programarCronParticiones(
    cola: Queue,
    opciones: { patron?: string; alArrancar?: boolean } = {},
): Promise<void> {
    await cola.upsertJobScheduler(
        ID_PARTICIONES,
        { pattern: opciones.patron ?? PATRON_PARTICIONES, tz: 'UTC' },
        { name: ID_PARTICIONES, opts: { removeOnComplete: 24, removeOnFail: 100 } },
    )
    if (opciones.alArrancar ?? true) {
        await cola.add(ID_PARTICIONES, {}, { removeOnComplete: 24, removeOnFail: 100 })
    }
}
