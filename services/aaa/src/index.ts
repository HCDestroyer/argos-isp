import { Redis } from 'ioredis'
import { ColaAccountingBullmq } from './accounting.ts'
import { crearApp } from './app.ts'
import { claveDesdeEntorno } from './cifrado.ts'
import { leerConfig } from './config.ts'
import { FuenteApi, FuenteFixtures, ResolutorServicios, type FuenteRespaldo } from './fuentes.ts'

const config = leerConfig()
const clave = claveDesdeEntorno(config.claveSecretos)

const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.db,
    // Falla rápido: si Redis no responde se autoriza por el respaldo dentro del timeout de rlm_rest (0.8 s).
    commandTimeout: 150,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    // Los GET del mismo tick salen en una sola escritura al socket (reconexiones masivas).
    enableAutoPipelining: true,
})
redis.on('error', () => {
    // El estado se ve en /health y en el log de cada autorización que use el respaldo.
})

const respaldo: FuenteRespaldo =
    config.respaldo === 'fixtures'
        ? await FuenteFixtures.desdeArchivo(config.fixturesRuta, clave)
        : new FuenteApi(config.api)

// Conexión propia de BullMQ: sin cola offline, para que un Redis caído se note en el acto (503).
const cola = new ColaAccountingBullmq({
    conexion: {
        host: config.redis.host,
        port: config.redis.port,
        db: config.redis.db,
        connectTimeout: 1000,
        enableOfflineQueue: false,
    },
    prefijo: config.colasPrefijo,
})

const app = crearApp({
    metricasToken: process.env.METRICS_TOKEN || undefined,
    resolutor: new ResolutorServicios({
        redis,
        prefijo: config.redis.prefijo,
        respaldo,
        log: { warn: (obj, msg) => app.log.warn(obj, msg) },
    }),
    claveSecretos: clave,
    perfil: { suspendido: config.suspendido, interimSegundos: config.interimSegundos },
    logLevel: config.logLevel,
    redisListo: () => redis.status === 'ready',
    cola,
})

await app.listen({ port: config.port, host: config.host })
if (respaldo instanceof FuenteApi) await respaldo.calentar()
app.log.info(
    { respaldo: respaldo.nombre, redis: `${config.redis.host}:${config.redis.port}/${config.redis.db}` },
    'aaa listo',
)

async function apagar(signal: string): Promise<void> {
    app.log.info(`${signal}: cerrando`)
    setTimeout(() => process.exit(1), 10_000).unref()
    await app.close()
    await cola.cerrar().catch(() => {})
    redis.disconnect()
    process.exit(0)
}

process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))
