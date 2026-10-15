import { Redis, type RedisOptions } from 'ioredis'
import app from '@adonisjs/core/services/app'
import env from '#start/env'

/**
 * Conexión compartida a Redis para cachés y el bus de eventos (A1). BullMQ usa sus propias
 * conexiones (`app/notify/cola.ts`).
 *
 * - `redis()` devuelve una conexión perezosa única por proceso; se cierra sola al terminar la app.
 * - `nuevaConexionRedis()` crea una conexión aparte (los `XREADGROUP ... BLOCK` necesitan la suya).
 * - `prefijoColas()` es el prefijo de claves de colas y streams (`COLAS_PREFIJO`, por defecto
 *   `argosisp`). En producción el stream es `argos:eventos` sin prefijo (contrato); las pruebas
 *   anteponen el suyo para no chocar con otros agentes.
 */

export function opcionesRedis(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        lazyConnect: true,
        // falla rápido si Redis no está: los ganchos post-COMMIT no deben colgar la respuesta
        maxRetriesPerRequest: 2,
        connectTimeout: 2000,
    }
}

let compartida: Redis | null = null
const abiertas = new Set<Redis>()

export function redis(): Redis {
    if (!compartida) compartida = nuevaConexionRedis()
    return compartida
}

export function nuevaConexionRedis(opciones: Partial<RedisOptions> = {}): Redis {
    const conexion = new Redis({ ...opcionesRedis(), ...opciones })
    abiertas.add(conexion)
    conexion.once('end', () => abiertas.delete(conexion))
    // sin este manejador ioredis escribe cada reintento como error no capturado
    conexion.on('error', () => {})
    return conexion
}

/** Cierra todas las conexiones abiertas por este módulo. */
export async function cerrarRedis(): Promise<void> {
    const conexiones = [...abiertas]
    abiertas.clear()
    compartida = null
    await Promise.all(
        conexiones.map(async (c) => {
            try {
                await c.quit()
            } catch {
                c.disconnect()
            }
        }),
    )
}

app.terminating(cerrarRedis)

export function prefijoColas(): string {
    return env.get('COLAS_PREFIJO') ?? 'argosisp'
}
