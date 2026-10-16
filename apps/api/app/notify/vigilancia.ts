import type { Queue } from 'bullmq'
import { contextoSistema } from '#shared/contexto'
import VigilarCrons, { type ResultadoVigilar } from '#notify/actions/vigilar_crons'
import type { ColaEnvios } from '#notify/cola'

/**
 * Vigilancia de los crons de billing (tarea 7). Job scheduler en la cola `notify-cron` (la de
 * recordatorios y particiones) con id `vigilancia-crons`, cada 5 minutos. Vive en `notify:worker`
 * a propósito: si `billing-worker` está caído, alguien más tiene que darse cuenta.
 */

export const ID_VIGILANCIA = 'vigilancia-crons'
export const CADA_VIGILANCIA_MS = 5 * 60_000

export async function ejecutarVigilancia(cola: ColaEnvios, ahora?: string): Promise<ResultadoVigilar> {
    const resultado = await new VigilarCrons().execute({ ahora }, contextoSistema('cron'))
    await cola.encolar(resultado.encolar)
    return resultado
}

export async function programarCronVigilancia(cola: Queue, opciones: { cadaMs?: number } = {}) {
    await cola.upsertJobScheduler(
        ID_VIGILANCIA,
        { every: opciones.cadaMs ?? CADA_VIGILANCIA_MS },
        { name: ID_VIGILANCIA, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    )
}
