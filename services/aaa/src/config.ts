import { fileURLToPath } from 'node:url'
import type { PerfilSuspendido } from './perfil.ts'

/** Configuración del servicio desde el entorno. Documentada en `.env.example`. */
export interface Config {
    port: number
    host: string
    logLevel: string
    redis: { host: string; port: number; db: number; prefijo: string }
    /** Prefijo de BullMQ: el mismo `COLAS_PREFIJO` que el worker de `apps/api`. */
    colasPrefijo: string
    respaldo: 'api' | 'fixtures'
    api: { url: string; token: string; timeoutMs: number; conexiones: number }
    fixturesRuta: string
    claveSecretos: string | undefined
    suspendido: PerfilSuspendido
    interimSegundos: number
}

function numero(valor: string | undefined, porDefecto: number): number {
    if (valor === undefined || valor === '') return porDefecto
    const n = Number(valor)
    if (!Number.isFinite(n)) throw new Error(`valor numérico inválido: ${valor}`)
    return n
}

export function leerConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const respaldo = env.AAA_RESPALDO ?? 'api'
    if (respaldo !== 'api' && respaldo !== 'fixtures') throw new Error('AAA_RESPALDO debe ser api o fixtures')
    return {
        port: numero(env.PORT, 3100),
        host: env.HOST ?? '0.0.0.0',
        logLevel: env.LOG_LEVEL ?? 'info',
        redis: {
            host: env.REDIS_HOST ?? 'localhost',
            port: numero(env.REDIS_PORT, 6379),
            db: numero(env.REDIS_DB, 0),
            prefijo: env.AAA_REDIS_PREFIJO ?? 'aaa:user:',
        },
        colasPrefijo: env.COLAS_PREFIJO || 'argosisp',
        respaldo,
        api: {
            url: env.API_INTERNAL_URL ?? 'http://localhost:3333/api/v1/',
            token: env.AAA_INTERNAL_TOKEN ?? '',
            // rlm_rest espera 0,8 s: 150 ms de Redis + 600 ms de API dejan margen para responder.
            timeoutMs: numero(env.AAA_API_TIMEOUT_MS, 600),
            conexiones: numero(env.AAA_API_CONEXIONES, 16),
        },
        fixturesRuta:
            env.AAA_FIXTURES_RUTA ?? fileURLToPath(new URL('../fixtures/servicios.json', import.meta.url)),
        claveSecretos: env.AAA_PPP_KEY,
        suspendido: {
            rateLimit: env.AAA_SUSPENDIDO_RATE_LIMIT ?? '256k/256k',
            grupo: env.AAA_SUSPENDIDO_GRUPO ?? 'suspendido',
            addressList: env.AAA_SUSPENDIDO_ADDRESS_LIST ?? 'suspendidos',
            filterId: env.AAA_SUSPENDIDO_FILTER_ID ?? 'argos-corte.in',
        },
        interimSegundos: numero(env.AAA_INTERIM_SEGUNDOS, 300),
    }
}
