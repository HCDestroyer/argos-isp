import { Redis } from 'ioredis'
import pg from 'pg'
import { ColaAccountingBullmq } from './accounting.ts'
import { crearApp } from './app.ts'
import { claveDesdeEntorno } from './cifrado.ts'
import { leerConfig } from './config.ts'
import { FuenteApi, FuenteFixtures, ResolutorServicios, type FuenteRespaldo } from './fuentes.ts'
import { UltimoConocido } from './ultimo_conocido.ts'
import { ConsumidorClientes } from './clientes/consumidor.ts'
import { escribirClientes, leerRouters } from './clientes/generar.ts'
import { avisarRecarga } from './clientes/recarga.ts'

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

// Modo degradado: último perfil conocido de cada usuario (memoria + archivo opcional).
const ultimoConocido = new UltimoConocido({ ruta: config.degradado.ruta, max: config.degradado.max })
let cargados = 0
try {
    cargados = await ultimoConocido.cargar()
} catch (e) {
    // Un archivo ilegible no impide arrancar: el espejo lo vuelve a escribir.
    console.error(`aaa: no se pudo leer ${config.degradado.ruta}: ${(e as Error).message}`)
}

const app = crearApp({
    metricasToken: process.env.METRICS_TOKEN || undefined,
    resolutor: new ResolutorServicios({
        redis,
        prefijo: config.redis.prefijo,
        respaldo,
        log: { warn: (obj, msg) => app.log.warn(obj, msg) },
        ultimoConocido,
        modoDegradado: config.degradado.modo,
    }),
    ultimoConocido,
    claveSecretos: clave,
    perfil: { suspendido: config.suspendido, interimSegundos: config.interimSegundos },
    logLevel: config.logLevel,
    redisListo: () => redis.status === 'ready',
    cola,
})

await app.listen({ port: config.port, host: config.host })
if (respaldo instanceof FuenteApi) await respaldo.calentar()
app.log.info(
    {
        respaldo: respaldo.nombre,
        redis: `${config.redis.host}:${config.redis.port}/${config.redis.db}`,
        degradado: config.degradado.modo,
        ultimo_conocido_archivo: config.degradado.ruta ?? null,
        ultimo_conocido_cargados: cargados,
    },
    'aaa listo',
)

// Clientes de FreeRADIUS por evento (router.conexion_*): conexión de Redis propia (XREADGROUP
// bloquea) y un pool de Postgres de una conexión, como `pnpm aaa:clients`.
let clientes: { consumidor: ConsumidorClientes; redis: Redis; pool: pg.Pool } | undefined
if (config.clientes.activo) {
    const c = config.clientes
    const pool = new pg.Pool({ ...c.db, max: 1 })
    pool.on('error', () => {})
    const redisEventos = new Redis({ host: config.redis.host, port: config.redis.port, db: config.redis.db })
    redisEventos.on('error', () => {})
    const consumidor = new ConsumidorClientes({
        redis: redisEventos,
        stream: c.stream,
        grupo: c.grupo,
        consumidor: c.consumidor,
        regenerar: async () =>
            escribirClientes({
                routers: await leerRouters(pool),
                clave,
                dir: c.dir,
                excluirNasIps: c.excluirNasIps,
            }),
        recargar: (motivo) => avisarRecarga(c.dir, motivo),
        log: {
            info: (o, m) => app.log.info(o, m),
            warn: (o, m) => app.log.warn(o, m),
            error: (o, m) => app.log.error(o, m),
        },
    })
    await consumidor.iniciar()
    clientes = { consumidor, redis: redisEventos, pool }
    app.log.info({ dir: c.dir, grupo: c.grupo }, 'clientes RADIUS por evento')
}

/** Copia `aaa:user:*` al último perfil conocido y la vuelca al archivo. Nunca dos a la vez. */
let espejando = false
async function espejar(): Promise<void> {
    if (espejando || redis.status !== 'ready') return
    espejando = true
    const inicio = performance.now()
    try {
        const r = await ultimoConocido.espejar(redis, config.redis.prefijo)
        await ultimoConocido.volcar()
        app.log.info(
            { ...r, registros: ultimoConocido.tamano, ms: Math.round(performance.now() - inicio) },
            'último perfil conocido: espejo de Redis',
        )
    } catch (e) {
        app.log.warn(
            { error: (e as Error).message },
            'último perfil conocido: espejo fallido (se conserva el anterior)',
        )
    } finally {
        espejando = false
    }
}
const relojEspejo =
    config.degradado.modo === 'aceptar' && config.degradado.espejoSegundos > 0
        ? setInterval(() => void espejar(), config.degradado.espejoSegundos * 1000)
        : undefined
relojEspejo?.unref()
// Primer espejo al arrancar, sin bloquear el arranque (Redis puede tardar en conectar).
if (relojEspejo) setTimeout(() => void espejar(), 2000).unref()

async function apagar(signal: string): Promise<void> {
    app.log.info(`${signal}: cerrando`)
    setTimeout(() => process.exit(1), 10_000).unref()
    clearInterval(relojEspejo)
    await app.close()
    await ultimoConocido.volcar().catch(() => {})
    await cola.cerrar().catch(() => {})
    if (clientes) {
        const fin = clientes.consumidor.detener()
        clientes.redis.disconnect()
        await fin.catch(() => {})
        await clientes.pool.end().catch(() => {})
    }
    redis.disconnect()
    process.exit(0)
}

process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))
