import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { nuevaConexionRedis, prefijoColas, redis } from '#shared/redis'

/**
 * Caché en memoria de los parámetros fiscales, por empresa (contrato §3.2). **Sin TTL** (regla 5):
 * se invalida por el evento `fiscal.parametros_cambiados`.
 *
 * Un grupo del bus entrega cada evento a un solo proceso, así que el aviso entre procesos va por
 * Redis Pub/Sub (`<COLAS_PREFIJO>:fiscal:parametros`): la acción que cambia un parámetro lo publica
 * al confirmar, y el consumidor del evento (`ConsumidorFiscal`, billing-worker) lo vuelve a publicar
 * por si ese aviso se perdió. La caché solo se usa mientras este proceso está suscrito: sin Redis,
 * o al reconectar, se descarta todo y se lee la base. Así nunca sirve un valor viejo por no haber
 * oído un aviso.
 */

type Cargar<T> = () => Promise<T>

/** Identifica los avisos que publica este proceso (no hace falta oírlos de vuelta). */
const ID_PROCESO = randomUUID()

class CacheParametros {
    #entradas = new Map<string, Promise<unknown>>()
    #suscriptor: Redis | null = null
    #lista = false
    /** apagada en pruebas salvo que la prueba la encienda (`activar`) */
    #activa = env.get('NODE_ENV') !== 'test'

    /** Valor de `clave` (empresa o `global:<pais>`), cargándolo si no está. */
    async obtener<T>(clave: string, cargar: Cargar<T>): Promise<T> {
        if (!this.#activa) return cargar()
        this.#suscribir()
        if (!this.#lista) return cargar()
        const existente = this.#entradas.get(clave) as Promise<T> | undefined
        if (existente) return existente
        const promesa = cargar().catch((error: unknown) => {
            this.#entradas.delete(clave)
            throw error
        })
        this.#entradas.set(clave, promesa)
        return promesa
    }

    /** Descarta la empresa (null = todo: un valor global afecta a todas). Solo este proceso. */
    invalidar(empresaId: number | null): void {
        if (empresaId === null) this.#entradas.clear()
        else this.#entradas.delete(String(empresaId))
    }

    get tamano(): number {
        return this.#entradas.size
    }

    get lista(): boolean {
        return this.#lista
    }

    /** Pruebas: enciende la caché y espera la suscripción. */
    async activar(): Promise<void> {
        this.#activa = true
        this.#suscribir()
        for (let i = 0; i < 50 && !this.#lista; i++) await new Promise((r) => setTimeout(r, 20))
    }

    /** Pruebas: apaga la caché y cierra la suscripción. */
    async desactivar(): Promise<void> {
        this.#activa = false
        this.#lista = false
        this.#entradas.clear()
        const conexion = this.#suscriptor
        this.#suscriptor = null
        if (!conexion) return
        try {
            await conexion.quit()
        } catch {
            conexion.disconnect()
        }
    }

    #suscribir(): void {
        if (this.#suscriptor) return
        const conexion = nuevaConexionRedis({ maxRetriesPerRequest: null })
        this.#suscriptor = conexion
        const perder = () => {
            this.#lista = false
            this.#entradas.clear()
        }
        conexion.on('close', perder)
        conexion.on('end', perder)
        conexion.on('message', (canal: string, mensaje: string) => {
            if (canal !== canalInvalidacion()) return
            try {
                const { empresa_id: empresaId, origen } = JSON.parse(mensaje) as {
                    empresa_id: number | null
                    origen?: string
                }
                // lo que publicó este mismo proceso ya se invalidó al confirmar
                if (origen === ID_PROCESO) return
                this.invalidar(typeof empresaId === 'number' ? empresaId : null)
            } catch {
                this.invalidar(null)
            }
        })
        const suscribirse = () =>
            conexion
                .subscribe(canalInvalidacion())
                .then(() => {
                    // lo que se cargó antes de (re)suscribirse pudo perder un aviso
                    this.#entradas.clear()
                    this.#lista = true
                })
                .catch((error: unknown) => {
                    logger.warn({ err: error }, 'fiscal: sin suscripción a invalidaciones; se lee la base')
                })
        let primera = true
        conexion.on('ready', () => {
            if (primera) {
                primera = false
                return
            }
            // reconexión: confirmar la suscripción antes de volver a usar la caché
            void suscribirse()
        })
        void suscribirse()
    }
}

export const cacheParametros = new CacheParametros()

export function canalInvalidacion(): string {
    return `${prefijoColas()}:fiscal:parametros`
}

/** Avisa a los demás procesos. Si Redis falla queda en el log: el evento llega igual al worker. */
export async function publicarInvalidacion(
    empresaId: number | null,
    origen: string = ID_PROCESO,
): Promise<void> {
    try {
        await redis().publish(canalInvalidacion(), JSON.stringify({ empresa_id: empresaId, origen }))
    } catch (error) {
        logger.warn({ err: error }, 'fiscal: no se pudo publicar la invalidación de parámetros')
    }
}

/** Invalida aquí y avisa a los demás procesos (gancho posterior al COMMIT de las acciones). */
export async function invalidarParametros(empresaId: number | null): Promise<void> {
    cacheParametros.invalidar(empresaId)
    await publicarInvalidacion(empresaId)
}
