import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import { prefijoColas, redis } from '#shared/redis'
import {
    estadoRegistrado,
    RegistrarCaidaAaa,
    RegistrarRecuperacionAaa,
} from '#network/sesiones/actions/registrar_salud_aaa'

/**
 * Vigía de los nodos `aaa` (tarea 9 de A2): `GET <url>/health` cada `cadaMs`.
 *
 * - Un nodo que no responde 2xx (timeout, conexión rechazada, 5xx) durante `caidoTrasMs` (60 s)
 *   seguidos → `RegistrarCaidaAaa` → `aaa.caido { nodo, desde, ultimo_error }` por outbox.
 * - El primer health check bueno de un nodo caído → `RegistrarRecuperacionAaa` →
 *   `aaa.recuperado { nodo, desde, hasta, ultimo_error }`.
 * - Fuente de verdad de "está caído": el último `aaa.caido`/`aaa.recuperado` del nodo en
 *   `audit.outbox` (las acciones son idempotentes por nodo). En Redis solo vive la racha de fallos
 *   en curso (`<COLAS_PREFIJO>:aaa-salud:<nodo>`, hash `desde`/`ultimo_error`, sin TTL; se borra al
 *   primer health check bueno), para que otro vigía que tome el lock siga contando desde el mismo
 *   primer fallo.
 * - Un solo vigía activo: lock `<COLAS_PREFIJO>:lock:aaa-vigia` con dueño y renovación (regla 6),
 *   igual que el relay. El que no tiene el lock no sondea.
 */

export interface NodoAaa {
    nombre: string
    /** base del servicio, p. ej. `http://aaa:3100` */
    url: string
}

export type Sondeo = (url: string, timeoutMs: number) => Promise<void>

export interface OpcionesVigia {
    nodos: NodoAaa[]
    caidoTrasMs?: number
    cadaMs?: number
    timeoutMs?: number
    lockMs?: number
    conexion?: Redis
    /** prefijo de las claves de Redis (por defecto `COLAS_PREFIJO`) */
    prefijo?: string
    ahora?: () => Date
    sondear?: Sondeo
}

export interface ResultadoVuelta {
    activo: boolean
    nodos: Array<{ nodo: string; ok: boolean; evento: 'aaa.caido' | 'aaa.recuperado' | null }>
}

/** `nombre=url,nombre=url` (o solo `url`, que toma el host como nombre). */
export function parsearNodos(valor: string | undefined): NodoAaa[] {
    if (!valor) return []
    return valor
        .split(',')
        .map((parte) => parte.trim())
        .filter(Boolean)
        .map((parte) => {
            const igual = parte.indexOf('=')
            const url = igual > 0 ? parte.slice(igual + 1).trim() : parte
            const nombre = igual > 0 ? parte.slice(0, igual).trim() : new URL(url).host
            new URL(url) // valida
            return { nombre, url: url.replace(/\/+$/, '') }
        })
}

/**
 * Health check HTTP: resuelve con 2xx, lanza con cualquier otra cosa. Conexión nueva en cada sondeo
 * (`agent: false`): un socket reutilizado de un nodo que se cayó no debe confundir el diagnóstico.
 */
export const sondeoHttp: Sondeo = (url, timeoutMs) =>
    new Promise<void>((resolver, rechazar) => {
        const destino = new URL(`${url}/health`)
        const pedir = destino.protocol === 'https:' ? httpsRequest : httpRequest
        const peticion = pedir(destino, { method: 'GET', agent: false, timeout: timeoutMs }, (respuesta) => {
            respuesta.resume()
            const codigo = respuesta.statusCode ?? 0
            if (codigo >= 200 && codigo < 300) resolver()
            else rechazar(new Error(`HTTP ${codigo}`))
        })
        peticion.on('timeout', () => peticion.destroy(new Error(`sin respuesta en ${timeoutMs} ms`)))
        peticion.on('error', (error: NodeJS.ErrnoException) =>
            rechazar(
                new Error(
                    error.code && !error.message.startsWith('sin respuesta') ? error.code : error.message,
                ),
            ),
        )
        peticion.end()
    })

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

export class VigiaAaa {
    readonly dueno = randomUUID()
    readonly claveLock: string
    readonly #op: Required<Omit<OpcionesVigia, 'conexion' | 'prefijo'>>
    readonly #redis: Redis
    readonly #prefijo: string
    #activo = false
    #bucle: Promise<void> | null = null
    #despertar: (() => void) | null = null

    constructor(opciones: OpcionesVigia) {
        this.#op = {
            caidoTrasMs: 60_000,
            cadaMs: 5000,
            timeoutMs: 2000,
            lockMs: 30_000,
            ahora: () => new Date(),
            sondear: sondeoHttp,
            ...opciones,
        }
        this.#redis = opciones.conexion ?? redis()
        this.#prefijo = opciones.prefijo ?? prefijoColas()
        this.claveLock = `${this.#prefijo}:lock:aaa-vigia`
    }

    claveRacha(nodo: string): string {
        return `${this.#prefijo}:aaa-salud:${nodo}`
    }

    async tomarLock(): Promise<boolean> {
        const renovado = (await this.#redis.eval(
            RENOVAR_LOCK,
            1,
            this.claveLock,
            this.dueno,
            String(this.#op.lockMs),
        )) as number
        if (renovado === 1) return true
        return (await this.#redis.set(this.claveLock, this.dueno, 'PX', this.#op.lockMs, 'NX')) === 'OK'
    }

    async soltarLock(): Promise<void> {
        await this.#redis.eval(SOLTAR_LOCK, 1, this.claveLock, this.dueno)
    }

    /** Una vuelta: sondea todos los nodos (si tiene el lock) y registra caídas y recuperaciones. */
    async vuelta(): Promise<ResultadoVuelta> {
        if (!(await this.tomarLock())) return { activo: false, nodos: [] }
        const { nodos, sondear, timeoutMs } = this.#op
        const sondeos = await Promise.all(
            nodos.map(async (n) => {
                try {
                    await sondear(n.url, timeoutMs)
                    return { nodo: n, error: null }
                } catch (error) {
                    return { nodo: n, error: (error as Error).message || 'error desconocido' }
                }
            }),
        )
        const registrados = await estadoRegistrado(nodos.map((n) => n.nombre))
        const resultado: ResultadoVuelta = { activo: true, nodos: [] }
        for (const { nodo, error } of sondeos) {
            const evento =
                error === null
                    ? await this.#arriba(nodo, registrados.get(nodo.nombre) === 'caido')
                    : await this.#fallo(nodo, error, registrados.get(nodo.nombre) === 'caido')
            resultado.nodos.push({ nodo: nodo.nombre, ok: error === null, evento })
        }
        return resultado
    }

    async #arriba(nodo: NodoAaa, caido: boolean): Promise<'aaa.recuperado' | null> {
        const clave = this.claveRacha(nodo.nombre)
        const racha = await this.#redis.hgetall(clave)
        let evento: 'aaa.recuperado' | null = null
        if (caido) {
            const r = await new RegistrarRecuperacionAaa().execute(
                {
                    nodo: nodo.nombre,
                    hasta: this.#op.ahora().toISOString(),
                    ultimo_error: racha.ultimo_error ?? null,
                },
                contextoSistema('cron', randomUUID()),
            )
            if (r.emitido) {
                evento = 'aaa.recuperado'
                logger.info({ nodo: nodo.nombre }, 'aaa.recuperado')
            }
        }
        if (Object.keys(racha).length > 0) await this.#redis.del(clave)
        return evento
    }

    async #fallo(nodo: NodoAaa, error: string, caido: boolean): Promise<'aaa.caido' | null> {
        const clave = this.claveRacha(nodo.nombre)
        const ahora = this.#op.ahora()
        // HSETNX: el primer fallo de la racha fija `desde`; los siguientes solo el último error.
        await this.#redis.hsetnx(clave, 'desde', ahora.toISOString())
        await this.#redis.hset(clave, 'ultimo_error', error)
        const desde = (await this.#redis.hget(clave, 'desde')) ?? ahora.toISOString()
        if (caido || ahora.getTime() - new Date(desde).getTime() < this.#op.caidoTrasMs) return null
        const r = await new RegistrarCaidaAaa().execute(
            { nodo: nodo.nombre, desde, ultimo_error: error },
            contextoSistema('cron', randomUUID()),
        )
        if (!r.emitido) return null
        logger.error({ nodo: nodo.nombre, desde, error }, 'aaa.caido')
        return 'aaa.caido'
    }

    iniciar(): void {
        if (this.#activo) return
        this.#activo = true
        this.#bucle = this.#correr()
    }

    async detener(): Promise<void> {
        this.#activo = false
        this.#despertar?.()
        // Primero el lock: al recibir SIGTERM la app también cierra Redis y sale en paralelo. Si no
        // alcanza a soltarlo, vence solo en `lockMs` (30 s) y otro vigía lo toma.
        await this.soltarLock().catch(() => {})
        await this.#bucle
    }

    async #correr(): Promise<void> {
        while (this.#activo) {
            try {
                await this.vuelta()
            } catch (error) {
                // Redis o Postgres caídos: se reintenta en la próxima vuelta
                logger.error({ err: error }, 'aaa:vigilar: error en la vuelta')
            }
            if (!this.#activo) break
            await new Promise<void>((resolver) => {
                const t = setTimeout(resolver, this.#op.cadaMs)
                this.#despertar = () => {
                    clearTimeout(t)
                    resolver()
                }
            })
        }
    }
}
