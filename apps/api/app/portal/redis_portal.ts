import { Redis } from 'ioredis'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'

/**
 * Conexión a Redis del portal: contadores del límite de peticiones (`limite_peticiones.ts`) y
 * ventana de auditoría de las consultas públicas (`auditoria_unica.ts`). Ninguno guarda datos
 * de negocio: son contadores y marcas con expiración, no cachés (la regla 5 no aplica).
 *
 * Perezosa y con respuesta rápida (500 ms) si Redis no está, para que quien la usa decida qué
 * hacer sin colgar la página de corte.
 *
 * - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: las mismas de la API.
 * - `PORTAL_REDIS_PREFIJO`: prefijo de las claves (por defecto `COLAS_PREFIJO` o `argosisp`);
 *   las pruebas usan uno propio.
 */

let compartida: Redis | undefined

export function redisPortal(): Redis {
    if (compartida) return compartida
    const redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        commandTimeout: 500,
        maxRetriesPerRequest: 1,
    })
    redis.on('error', (error) => logger.warn({ err: error }, 'Redis del portal no disponible'))
    app.terminating(async () => {
        await redis.quit().catch(() => redis.disconnect())
    })
    compartida = redis
    return redis
}

/** Prefijo de las claves del portal en Redis; se lee en cada uso. */
export function prefijoRedisPortal(entorno: NodeJS.ProcessEnv = process.env): string {
    return entorno.PORTAL_REDIS_PREFIJO || entorno.COLAS_PREFIJO || 'argosisp'
}

/** Entero de una variable de entorno; lanza si no es un entero >= `minimo` (error de configuración). */
export function enteroDeEntorno(
    entorno: NodeJS.ProcessEnv,
    nombre: string,
    defecto: number,
    minimo: number,
): number {
    const texto = entorno[nombre]?.trim()
    if (!texto) return defecto
    const valor = Number(texto)
    if (!Number.isInteger(valor) || valor < minimo) {
        throw new Error(`${nombre}: se esperaba un entero >= ${minimo}, llegó "${texto}"`)
    }
    return valor
}
