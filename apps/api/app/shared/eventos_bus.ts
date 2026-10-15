import { hostname } from 'node:os'
import type { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { nuevaConexionRedis, prefijoColas } from '#shared/redis'

/**
 * Bus de eventos sobre Redis Streams (tarea 10 de A1). Contrato en
 * `.claude/integration/contratos/eventos.md`.
 *
 * - El relay (`relay_outbox.ts`, comando `node ace eventos:relay`) publica `audit.outbox` en el
 *   stream `argos:eventos` con los campos `id`, `evento`, `payload` y `request_id`.
 * - Cada módulo consume con su propio grupo usando `EjecutorGrupo`: `XREADGROUP` + `XACK`, y
 *   `XAUTOCLAIM` de lo pendiente hace más de 60 s (un consumidor que lanzó o un proceso que cayó).
 * - Entrega al menos una vez: los consumidores son idempotentes por `id`.
 */

/** Evento tal como lo entrega el bus: `id` es el id de `audit.outbox`. */
export interface EventoEntrante {
    id: number | string
    evento: string
    payload: Record<string, unknown>
    /** `audit.outbox.request_id` de la acción que emitió el evento */
    requestId?: string | null
}

/** Contrato de un consumidor de eventos del outbox. */
export interface ConsumidorEventos {
    readonly nombre: string
    acepta(evento: string): boolean
    /** Idempotente por `id`. Si lanza, el evento no se confirma y se reintenta. */
    procesar(evento: EventoEntrante): Promise<void>
}

/** Grupos del contrato. */
export const GRUPOS = ['coa', 'billing', 'notify', 'aaa-cache'] as const
export type Grupo = (typeof GRUPOS)[number]

/** Producción: `argos:eventos` (contrato). Pruebas: `<COLAS_PREFIJO>:argos:eventos`. */
export function nombreStream(): string {
    const configurado = env.get('EVENTOS_STREAM')
    if (configurado) return configurado
    return env.get('NODE_ENV') === 'test' ? `${prefijoColas()}:argos:eventos` : 'argos:eventos'
}

/** Entrada del stream (pares campo/valor) → `EventoEntrante`. null si no es un evento válido. */
export function aEvento(campos: string[] | null | undefined): EventoEntrante | null {
    if (!campos) return null
    const mapa = new Map<string, string>()
    for (let i = 0; i + 1 < campos.length; i += 2) mapa.set(campos[i]!, campos[i + 1]!)
    const id = mapa.get('id')
    const evento = mapa.get('evento')
    if (!id || !evento) return null
    let payload: Record<string, unknown> = {}
    try {
        const valor = JSON.parse(mapa.get('payload') ?? '{}') as unknown
        if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
            payload = valor as Record<string, unknown>
        }
    } catch {
        return null
    }
    const requestId = mapa.get('request_id')
    return { id: /^\d+$/.test(id) ? Number(id) : id, evento, payload, requestId: requestId || null }
}

export interface OpcionesEjecutor {
    grupo: Grupo | string
    consumidores: ConsumidorEventos[]
    stream?: string
    /** nombre del consumidor dentro del grupo (por defecto `<host>-<pid>`) */
    consumidor?: string
    /** eventos por lectura (por defecto 100) */
    lote?: number
    /** espera bloqueante de XREADGROUP en ms (por defecto 5000) */
    bloqueoMs?: number
    /** reclamar pendientes inactivos hace más de esto (por defecto 60 000 ms, contrato) */
    reclamarTrasMs?: number
    conexion?: Redis
}

type EntradaStream = [id: string, campos: string[] | null]

/**
 * Ejecuta los consumidores de un grupo sobre el stream. Uso:
 *
 * ```ts
 * const ejecutor = new EjecutorGrupo({ grupo: 'billing', consumidores: [new ConsumidorBilling()] })
 * ejecutor.iniciar()          // bucle hasta detener()
 * await ejecutor.detener()
 * ```
 *
 * Por cada entrada llama `procesar` de cada consumidor que la `acepta`, en orden; si todos
 * terminan bien hace `XACK`. Si alguno lanza, no confirma: la entrada queda pendiente y se
 * reclama con `XAUTOCLAIM` pasado `reclamarTrasMs` (se reentrega a todos los consumidores del
 * grupo, por eso deben ser idempotentes). Entradas ilegibles o borradas se confirman y se registran.
 */
export class EjecutorGrupo {
    readonly grupo: string
    readonly stream: string
    readonly consumidor: string
    readonly #consumidores: ConsumidorEventos[]
    readonly #lote: number
    readonly #bloqueoMs: number
    readonly #reclamarTrasMs: number
    readonly #propia: boolean
    readonly #redis: Redis
    #activo = false
    #bucle: Promise<void> | null = null
    #grupoListo = false

    constructor(opciones: OpcionesEjecutor) {
        this.grupo = opciones.grupo
        this.stream = opciones.stream ?? nombreStream()
        this.consumidor = opciones.consumidor ?? `${hostname()}-${process.pid}`
        this.#consumidores = opciones.consumidores
        this.#lote = opciones.lote ?? 100
        this.#bloqueoMs = opciones.bloqueoMs ?? 5000
        this.#reclamarTrasMs = opciones.reclamarTrasMs ?? 60_000
        this.#propia = !opciones.conexion
        // XREADGROUP BLOCK ocupa la conexión: cada ejecutor usa la suya
        this.#redis = opciones.conexion ?? nuevaConexionRedis({ maxRetriesPerRequest: null })
    }

    /** Crea el grupo (y el stream) si no existen. Un grupo nuevo empieza desde el principio. */
    async asegurarGrupo(): Promise<void> {
        try {
            await this.#redis.xgroup('CREATE', this.stream, this.grupo, '0', 'MKSTREAM')
        } catch (error) {
            if (!String((error as Error).message).includes('BUSYGROUP')) throw error
        }
        this.#grupoListo = true
    }

    /**
     * Una pasada: reclama pendientes vencidos y lee nuevos (bloqueando hasta `bloqueoMs`; 0 = no
     * bloquear). Devuelve cuántas entradas confirmó.
     */
    async procesarLote(opciones: { bloqueoMs?: number } = {}): Promise<number> {
        if (!this.#grupoListo) await this.asegurarGrupo()
        let confirmadas = 0
        try {
            confirmadas += await this.#reclamarPendientes()
            const bloqueo = opciones.bloqueoMs ?? this.#bloqueoMs
            const args: Array<string | number> = ['GROUP', this.grupo, this.consumidor, 'COUNT', this.#lote]
            if (bloqueo > 0) args.push('BLOCK', bloqueo)
            args.push('STREAMS', this.stream, '>')
            const respuesta = (await (this.#redis as any).xreadgroup(...args)) as Array<
                [string, EntradaStream[]]
            > | null
            for (const [, entradas] of respuesta ?? []) confirmadas += await this.#procesarEntradas(entradas)
        } catch (error) {
            if (String((error as Error).message).includes('NOGROUP')) {
                // el stream se borró: se recrea en la próxima pasada
                this.#grupoListo = false
                return confirmadas
            }
            throw error
        }
        return confirmadas
    }

    async #reclamarPendientes(): Promise<number> {
        let confirmadas = 0
        let inicio = '0-0'
        // como mucho 10 páginas por pasada: el resto se reclama en la siguiente
        for (let pagina = 0; pagina < 10; pagina++) {
            const [siguiente, entradas, borradas] = (await this.#redis.xautoclaim(
                this.stream,
                this.grupo,
                this.consumidor,
                this.#reclamarTrasMs,
                inicio,
                'COUNT',
                this.#lote,
            )) as [string, EntradaStream[], string[]?]
            if (borradas && borradas.length > 0) {
                await this.#redis.xack(this.stream, this.grupo, ...borradas)
            }
            confirmadas += await this.#procesarEntradas(entradas)
            inicio = siguiente
            if (inicio === '0-0') break
        }
        return confirmadas
    }

    async #procesarEntradas(entradas: EntradaStream[]): Promise<number> {
        let confirmadas = 0
        for (const [idStream, campos] of entradas) {
            const evento = aEvento(campos)
            if (!evento) {
                logger.warn({ grupo: this.grupo, idStream }, 'Entrada del stream ilegible: se descarta')
                await this.#redis.xack(this.stream, this.grupo, idStream)
                confirmadas++
                continue
            }
            try {
                for (const consumidor of this.#consumidores) {
                    if (consumidor.acepta(evento.evento)) await consumidor.procesar(evento)
                }
            } catch (error) {
                logger.error(
                    { err: error, grupo: this.grupo, outboxId: evento.id, evento: evento.evento },
                    'Consumidor de eventos falló: se reintentará',
                )
                continue
            }
            await this.#redis.xack(this.stream, this.grupo, idStream)
            confirmadas++
        }
        return confirmadas
    }

    /** Bucle hasta `detener()`. Los errores de Redis se registran y se reintenta tras 1 s. */
    iniciar(): void {
        if (this.#activo) return
        this.#activo = true
        this.#bucle = (async () => {
            while (this.#activo) {
                try {
                    await this.procesarLote()
                } catch (error) {
                    if (!this.#activo) break
                    logger.error({ err: error, grupo: this.grupo }, 'Error leyendo el stream de eventos')
                    await new Promise((r) => setTimeout(r, 1000))
                }
            }
        })()
    }

    async detener(): Promise<void> {
        this.#activo = false
        // corta el XREADGROUP bloqueado
        if (this.#propia) this.#redis.disconnect()
        await this.#bucle
        this.#bucle = null
    }
}
