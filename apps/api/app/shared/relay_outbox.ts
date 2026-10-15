import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { nombreStream } from '#shared/eventos_bus'
import { prefijoColas, redis } from '#shared/redis'

/**
 * Relay del outbox (tarea 10 de A1): `audit.outbox` → Redis Stream `argos:eventos`.
 *
 * - Lee las filas con `publicado_en IS NULL` en orden de `id`, por lotes, dentro de una
 *   transacción (`FOR UPDATE`), hace `XADD ... MAXLEN ~ 100000` de cada una en un pipeline y marca
 *   `publicado_en` (e incrementa `intentos`). Si el proceso cae entre el XADD y el COMMIT, el lote
 *   se publica otra vez: entrega al menos una vez.
 * - Un solo relay activo: lock en Redis (`<COLAS_PREFIJO>:lock:eventos-relay`) con dueño y
 *   renovación. Un relay sin lock espera y reintenta tomarlo.
 */

export const MAXLEN_STREAM = 100_000

interface FilaOutbox {
    id: number
    evento: string
    payload: unknown
    request_id: string | null
}

export interface OpcionesRelay {
    stream?: string
    /** filas por lote (por defecto 500) */
    lote?: number
    /** espera entre sondeos cuando no hay pendientes (por defecto 250 ms) */
    esperaMs?: number
    /** duración del lock; se renueva en cada vuelta (por defecto 30 s) */
    lockMs?: number
    conexion?: Redis
}

const RENOVAR_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`

const SOLTAR_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`

export class RelayOutbox {
    readonly stream: string
    readonly claveLock: string
    readonly dueno = randomUUID()
    readonly #lote: number
    readonly #esperaMs: number
    readonly #lockMs: number
    readonly #redis: Redis
    #activo = false
    #bucle: Promise<void> | null = null

    constructor(opciones: OpcionesRelay = {}) {
        this.stream = opciones.stream ?? nombreStream()
        this.claveLock = `${prefijoColas()}:lock:eventos-relay`
        this.#lote = opciones.lote ?? 500
        this.#esperaMs = opciones.esperaMs ?? 250
        this.#lockMs = opciones.lockMs ?? 30_000
        this.#redis = opciones.conexion ?? redis()
    }

    /** Toma o renueva el lock. true si este relay es el activo. */
    async tomarLock(): Promise<boolean> {
        const renovado = (await this.#redis.eval(
            RENOVAR_LOCK,
            1,
            this.claveLock,
            this.dueno,
            String(this.#lockMs),
        )) as number
        if (renovado === 1) return true
        const tomado = await this.#redis.set(this.claveLock, this.dueno, 'PX', this.#lockMs, 'NX')
        return tomado === 'OK'
    }

    async soltarLock(): Promise<void> {
        await this.#redis.eval(SOLTAR_LOCK, 1, this.claveLock, this.dueno)
    }

    /** Publica un lote de pendientes. Devuelve cuántos publicó. No verifica el lock. */
    async publicarLote(): Promise<number> {
        return db.transaction(async (trx) => {
            const filas = (await trx
                .from('audit.outbox')
                .whereNull('publicado_en')
                .orderBy('id', 'asc')
                .limit(this.#lote)
                .forUpdate()
                .select('id', 'evento', 'payload', 'request_id')) as FilaOutbox[]
            if (filas.length === 0) return 0

            const tuberia = this.#redis.pipeline()
            for (const fila of filas) {
                tuberia.xadd(
                    this.stream,
                    'MAXLEN',
                    '~',
                    MAXLEN_STREAM,
                    '*',
                    'id',
                    String(fila.id),
                    'evento',
                    fila.evento,
                    'payload',
                    typeof fila.payload === 'string' ? fila.payload : JSON.stringify(fila.payload),
                    'request_id',
                    fila.request_id ?? '',
                )
            }
            const resultados = (await tuberia.exec()) ?? []
            const error = resultados.find(([e]) => e)?.[0]
            if (error) throw error

            await trx
                .from('audit.outbox')
                .whereIn(
                    'id',
                    filas.map((f) => f.id),
                )
                .update({
                    publicado_en: trx.knexRawQuery('now()'),
                    intentos: trx.knexRawQuery('intentos + 1'),
                } as Record<string, unknown>)
            return filas.length
        })
    }

    /** Publica todo lo pendiente hasta ahora (si tiene el lock). Devuelve el total publicado. */
    async publicarPendientes(): Promise<number> {
        let total = 0
        while (await this.tomarLock()) {
            const publicados = await this.publicarLote()
            total += publicados
            if (publicados < this.#lote) break
        }
        return total
    }

    /** Bucle hasta `detener()`. */
    iniciar(): void {
        if (this.#activo) return
        this.#activo = true
        this.#bucle = (async () => {
            let avisado = false
            while (this.#activo) {
                try {
                    if (!(await this.tomarLock())) {
                        if (!avisado) logger.info('Otro relay del outbox está activo: en espera')
                        avisado = true
                        await dormir(Math.min(this.#lockMs / 3, 5000))
                        continue
                    }
                    avisado = false
                    const publicados = await this.publicarLote()
                    if (publicados < this.#lote) await dormir(this.#esperaMs)
                } catch (error) {
                    logger.error({ err: error }, 'Relay del outbox: error, se reintenta')
                    await dormir(1000)
                }
            }
        })()
    }

    async detener(): Promise<void> {
        this.#activo = false
        await this.#bucle
        this.#bucle = null
        try {
            await this.soltarLock()
        } catch {
            // el lock vence solo
        }
    }
}

function dormir(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}
