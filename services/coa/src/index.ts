import { Redis } from 'ioredis'
import { AlmacenPg } from './almacen.ts'
import { crearServidor } from './app.ts'
import { claveDesdeEntorno } from './cifrado.ts'
import { leerConfig } from './config.ts'
import { ConsumidorStream } from './consumidor.ts'
import { Dispatcher } from './dispatcher.ts'
import { crearLog } from './log.ts'
import { ClienteNasUdp } from './nas.ts'
import { MetricasCoa } from './metricas.ts'

const config = leerConfig()
const log = crearLog(config.logLevel)
const clave = claveDesdeEntorno(config.claveSecretos)

const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.db,
    password: config.redis.password,
    // XREADGROUP BLOCK: sin límite de reintentos por comando, reconecta solo.
    maxRetriesPerRequest: null,
})
redis.on('error', () => {
    // Se ve en /health y en el log del bucle del consumidor.
})

const metricas = new MetricasCoa()
const almacen = new AlmacenPg(config.db, { redis, prefijo: config.aaaPrefijo })
const dispatcher = new Dispatcher({
    almacen,
    nas: new ClienteNasUdp(config.nas.origen),
    claveSecretos: clave,
    suspendido: config.suspendido,
    suspenderConIpv6: config.suspenderConIpv6,
    puertoNas: config.nas.puerto,
    timeoutMs: config.nas.timeoutMs,
    reintentos: config.nas.reintentos,
    esperaMs: config.nas.esperaMs,
    log,
    metricas,
})
const consumidor = new ConsumidorStream({
    redis,
    stream: config.stream,
    grupo: config.grupo,
    consumidor: config.consumidor,
    grupoInicio: config.grupoInicio,
    reclamarTrasMs: config.reclamarTrasMs,
    procesador: dispatcher,
    log,
})

const servidor = crearServidor({
    consumidor: () => ({ activo: consumidor.activo, ultimaLectura: consumidor.ultimaLectura }),
    redisListo: () => redis.status === 'ready',
    metricas,
    metricasToken: process.env.METRICS_TOKEN || undefined,
    // XPENDING resumido: [cantidad, primero, último, consumidores]
    pendientes: async () => {
        const r = (await redis.xpending(config.stream, config.grupo)) as [number, ...unknown[]]
        return Number(r[0] ?? 0)
    },
})
servidor.listen(config.port, config.host, () => {
    log.info(
        {
            stream: config.stream,
            grupo: config.grupo,
            consumidor: config.consumidor,
            puerto_nas: config.nas.puerto,
        },
        `coa escuchando en ${config.host}:${config.port}`,
    )
})
consumidor.iniciar()

async function apagar(signal: string): Promise<void> {
    log.info({}, `${signal}: cerrando`)
    setTimeout(() => process.exit(1), 10_000).unref()
    await consumidor.detener()
    servidor.close()
    await almacen.cerrar().catch(() => {})
    redis.disconnect()
    process.exit(0)
}

process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))
