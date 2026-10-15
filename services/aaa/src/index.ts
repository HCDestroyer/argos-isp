import { Redis } from 'ioredis'
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
})
redis.on('error', () => {
    // El estado se ve en /health y en el log de cada autorización que use el respaldo.
})

const respaldo: FuenteRespaldo =
    config.respaldo === 'fixtures'
        ? await FuenteFixtures.desdeArchivo(config.fixturesRuta, clave)
        : new FuenteApi(config.api)

const app = crearApp({
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
})

await app.listen({ port: config.port, host: config.host })
app.log.info(
    { respaldo: respaldo.nombre, redis: `${config.redis.host}:${config.redis.port}/${config.redis.db}` },
    'aaa listo',
)

async function apagar(signal: string): Promise<void> {
    app.log.info(`${signal}: cerrando`)
    setTimeout(() => process.exit(1), 10_000).unref()
    await app.close()
    redis.disconnect()
    process.exit(0)
}

process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))
