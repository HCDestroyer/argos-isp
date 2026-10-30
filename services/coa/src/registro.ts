import type { Redis } from 'ioredis'

/**
 * Cadenas completas de `Mikrotik-Rate-Limit` de un servicio PPPoE (`plan.rate_limit` y
 * `plan.rate_limit_limitado` de `contratos/aaa.md`): las calcula A1 con
 * `apps/api/app/network/velocidad.ts` y son las mismas que entrega `aaa` al conectar.
 *
 * De dónde salen, en orden:
 *   1. Redis `aaa:user:<user_ppp>` (lo mantiene A1 por evento, sin TTL).
 *   2. Si no está, es de otro servicio, no trae las cadenas o Redis falla:
 *      `GET <API_INTERNAL_URL>internal/aaa/servicio?user_ppp=` con el mismo Bearer que `aaa`,
 *      con `reintentos` y backoff ante error de red, timeout o 5xx.
 *
 * `coa` nunca arma un rate-limit por su cuenta (con `subida/bajada` perdía CIR, prioridad y
 * ráfaga y difería de lo que manda `aaa`): si ninguna fuente responde, devuelve el error y el
 * dispatcher registra el fallo con `coa.fallido` sin enviar nada.
 */

export interface RateLimits {
    rate_limit: string
    rate_limit_limitado: string
    /** Reuso efectivo del plan en el router (1 si el registro no lo trae) */
    reuso: number
    /** `control_velocidad` del router (`simple` si el registro no lo trae) */
    control_velocidad: 'simple' | 'arbol_pcq'
    /** Estrategia por capas (`velocidad.aplicacion` y `velocidad.grupo`); null en registros anteriores */
    aplicacion: string | null
    grupo: string | null
}

export type ResultadoRateLimits = { ok: true; valor: RateLimits } | { ok: false; error: string }

export interface FuenteRateLimits {
    obtener(servicioId: number, userPpp: string): Promise<ResultadoRateLimits>
}

export interface OpcionesApi {
    /** Base con el prefijo de la API, p. ej. `http://api:3333/api/v1/` */
    url: string
    token: string
    timeoutMs: number
    reintentos: number
    esperaMs: number
}

/** Extrae las cadenas del JSON de `contratos/aaa.md` si es del servicio esperado. */
export function rateLimitsDeRegistro(datos: unknown, servicioId: number): RateLimits | null {
    if (typeof datos !== 'object' || datos === null) return null
    const r = datos as {
        servicio_id?: unknown
        eliminado?: unknown
        control_velocidad?: unknown
        plan?: Record<string, unknown>
        velocidad?: { aplicacion?: unknown; grupo?: unknown } | null
    }
    if (r.eliminado === true || Number(r.servicio_id) !== servicioId) return null
    const rate = r.plan?.rate_limit
    const limitado = r.plan?.rate_limit_limitado
    if (typeof rate !== 'string' || rate === '' || typeof limitado !== 'string' || limitado === '')
        return null
    const reuso = Number(r.plan?.reuso)
    return {
        rate_limit: rate,
        rate_limit_limitado: limitado,
        reuso: Number.isInteger(reuso) && reuso >= 1 ? reuso : 1,
        control_velocidad: r.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
        aplicacion: typeof r.velocidad?.aplicacion === 'string' ? r.velocidad.aplicacion : null,
        grupo: typeof r.velocidad?.grupo === 'string' ? r.velocidad.grupo : null,
    }
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

export class FuenteRedisApi implements FuenteRateLimits {
    readonly #redis: Redis | null
    readonly #prefijo: string
    readonly #api: OpcionesApi | null

    constructor(opciones: { redis: Redis | null; prefijo: string; api: OpcionesApi | null }) {
        this.#redis = opciones.redis
        this.#prefijo = opciones.prefijo
        this.#api = opciones.api
            ? {
                  ...opciones.api,
                  url: opciones.api.url.endsWith('/') ? opciones.api.url : `${opciones.api.url}/`,
              }
            : null
    }

    async obtener(servicioId: number, userPpp: string): Promise<ResultadoRateLimits> {
        const cache = await this.#deRedis(servicioId, userPpp)
        if (cache) return { ok: true, valor: cache }
        if (!this.#api) {
            return { ok: false, error: `sin aaa:user:${userPpp} en Redis y sin API_INTERNAL_URL` }
        }
        return this.#deApi(this.#api, servicioId, userPpp)
    }

    async #deRedis(servicioId: number, userPpp: string): Promise<RateLimits | null> {
        if (!this.#redis) return null
        try {
            const crudo = await this.#redis.get(`${this.#prefijo}${userPpp}`)
            return crudo ? rateLimitsDeRegistro(JSON.parse(crudo), servicioId) : null
        } catch {
            return null
        }
    }

    async #deApi(api: OpcionesApi, servicioId: number, userPpp: string): Promise<ResultadoRateLimits> {
        const url = new URL('internal/aaa/servicio', api.url)
        url.searchParams.set('user_ppp', userPpp)
        const maximo = 1 + Math.max(0, api.reintentos)
        let ultimo = ''
        for (let intento = 1; intento <= maximo; intento++) {
            try {
                const res = await fetch(url, {
                    headers: { authorization: `Bearer ${api.token}`, accept: 'application/json' },
                    signal: AbortSignal.timeout(api.timeoutMs),
                })
                if (res.status === 200) {
                    const valor = rateLimitsDeRegistro(await res.json(), servicioId)
                    if (valor) return { ok: true, valor }
                    return { ok: false, error: `la API no trae el rate-limit del servicio ${servicioId}` }
                }
                if (res.status === 404) {
                    return { ok: false, error: `la API no conoce el user_ppp ${userPpp}` }
                }
                ultimo = `API interna respondió ${res.status}`
                // 4xx (token inválido, ruta mal configurada): reintentar no lo arregla.
                if (res.status < 500) return { ok: false, error: ultimo }
            } catch (e) {
                ultimo = `API interna no responde: ${(e as Error).name}`
            }
            if (intento < maximo) await dormir(api.esperaMs * 2 ** (intento - 1))
        }
        return { ok: false, error: `${ultimo} (${maximo} intentos)` }
    }
}
