import { Queue, Worker, type RedisOptions } from 'bullmq'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import { Problema } from '#shared/errores'
import PrepararAprovisionamiento from '#integraciones/equipos/actions/preparar_aprovisionamiento'
import ActivarAprovisionamiento from '#integraciones/equipos/actions/activar_aprovisionamiento'
import FallarAprovisionamiento from '#integraciones/equipos/actions/fallar_aprovisionamiento'
import AplicarWifi from '#integraciones/equipos/actions/aplicar_wifi'

/**
 * Cola BullMQ `equipos` (`node ace equipos:worker`):
 *
 * | Job | Cuándo | Qué hace |
 * | --- | --- | --- |
 * | `aprovisionar` | al aceptar (`jobId` `aprov-<id>`) | `PrepararAprovisionamiento` → `ActivarAprovisionamiento` (o `FallarAprovisionamiento`) |
 * | `wifi` | al aceptar (`jobId` `wifi-<id>`) | `AplicarWifi` |
 * | `pendientes` | cada 30 s (`EQUIPOS_PENDIENTES_CADA_MS`) | todo lo `en_proceso` con `proximo_intento_en` vencido (reintentos y lo que se perdió en Redis) |
 *
 * Lock: cada pedido toma un advisory lock de Postgres (`LOCK_EQUIPOS`, id del pedido); si otra
 * instancia lo tiene, el disparo se omite. El cron toma además su propio lock. Los jobs solo llaman
 * acciones (regla 1).
 */

export const NOMBRE_COLA_EQUIPOS = 'equipos'
const LOCK_EQUIPOS = 4161
const LOCK_WIFI = 4162
const LOCK_CRON = 4163

function conexion(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: null,
    }
}

function prefijo() {
    return env.get('COLAS_PREFIJO') ?? 'argosisp'
}

let cola: Queue | null = null

function colaEquipos(): Queue {
    cola ??= new Queue(NOMBRE_COLA_EQUIPOS, { connection: conexion(), prefix: prefijo() })
    return cola
}

/** Despierta al worker para un pedido recién aceptado. Si Redis falla, el cron lo toma igual. */
export async function encolarEquipos(tipo: 'aprovisionar' | 'wifi', id: number): Promise<void> {
    if (process.env.EQUIPOS_SIN_COLA === 'true') return
    await colaEquipos().add(
        tipo,
        { id },
        {
            jobId: `${tipo === 'aprovisionar' ? 'aprov' : 'wifi'}-${id}-${Date.now()}`,
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 500 },
        },
    )
}

async function conLock<T>(clase: number, id: number, trabajo: () => Promise<T>): Promise<T | null> {
    return db.transaction(async (trx) => {
        const { rows } = (await trx.rawQuery('SELECT pg_try_advisory_xact_lock(?, ?) AS ok', [
            clase,
            id,
        ])) as {
            rows: Array<{ ok: boolean }>
        }
        if (!rows[0]?.ok) return null
        return trabajo()
    })
}

/** Lleva un aprovisionamiento lo más lejos que se pueda ahora (worker, cron y pruebas). */
export async function procesarAprovisionamiento(id: number): Promise<string | null> {
    return conLock(LOCK_EQUIPOS, id, async () => {
        const ctx = contextoSistema('worker', `aprovisionamiento-${id}-${Date.now()}`)
        const r = await new PrepararAprovisionamiento().execute({ id }, ctx)
        if (r.resultado !== 'activar') return r.resultado
        try {
            await new ActivarAprovisionamiento().execute({ id }, ctx)
            return 'listo'
        } catch (error) {
            // solo errores de negocio (Problema): uno inesperado se relanza y el cron reintenta
            if (!(error instanceof Problema) || error.status >= 500) throw error
            await new FallarAprovisionamiento().execute(
                { id, codigo: error.tipo.split(':').pop() ?? null, detalle: error.detalle ?? error.message },
                ctx,
            )
            return 'fallido'
        }
    })
}

export async function procesarWifi(id: number): Promise<string | null> {
    return conLock(LOCK_WIFI, id, async () => {
        const ctx = contextoSistema('worker', `wifi-${id}-${Date.now()}`)
        const r = await new AplicarWifi().execute({ id }, ctx)
        return r.resultado
    })
}

/** «Todo lo pendiente hasta ahora» (regla 6): pedidos `en_proceso` con su próximo intento vencido. */
export async function procesarPendientesEquipos(
    ahora = new Date(),
): Promise<{ aprovisionamientos: number; wifi: number }> {
    const r = await conLock(LOCK_CRON, 0, async () => {
        const aprov = (await db
            .from('integraciones.aprovisionamientos')
            .where('estado', 'en_proceso')
            .where('proximo_intento_en', '<=', ahora)
            .orderBy('proximo_intento_en')
            .limit(50)
            .select('id')) as Array<{ id: number }>
        for (const a of aprov) await procesarAprovisionamiento(Number(a.id))
        const wifi = (await db
            .from('integraciones.wifi_solicitudes')
            .where('estado', 'en_proceso')
            .where('proximo_intento_en', '<=', ahora)
            .orderBy('proximo_intento_en')
            .limit(50)
            .select('id')) as Array<{ id: number }>
        for (const w of wifi) await procesarWifi(Number(w.id))
        return { aprovisionamientos: aprov.length, wifi: wifi.length }
    })
    return r ?? { aprovisionamientos: 0, wifi: 0 }
}

export async function iniciarWorkerEquipos(opciones: { cadaMs?: number } = {}) {
    const q = colaEquipos()
    await q.upsertJobScheduler(
        'pendientes',
        { every: opciones.cadaMs ?? Number(process.env.EQUIPOS_PENDIENTES_CADA_MS ?? 30_000) },
        {
            name: 'pendientes',
            data: {},
            opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } },
        },
    )
    const worker = new Worker(
        NOMBRE_COLA_EQUIPOS,
        async (job) => {
            if (job.name === 'pendientes') return procesarPendientesEquipos()
            const id = Number((job.data as { id?: unknown }).id)
            if (!Number.isSafeInteger(id) || id <= 0) return null
            return job.name === 'wifi' ? procesarWifi(id) : procesarAprovisionamiento(id)
        },
        { connection: conexion(), prefix: prefijo(), concurrency: 2 },
    )
    worker.on('failed', (job, error) =>
        logger.warn({ jobId: job?.id, tipo: job?.name, err: error }, 'equipos: job fallido'),
    )
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de equipos'))
    return { cola: q, worker }
}
