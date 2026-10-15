import { isIP } from 'node:net'
import type { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import { Problema } from '#shared/errores'
import { enteroDeEntorno, prefijoRedisPortal, redisPortal } from '#portal/redis_portal'

/**
 * Límite de peticiones de los endpoints públicos del portal (`quien-soy`, `estado`), por IP de
 * origen ya resuelta (`ipOrigenDeLaPeticion`).
 *
 * Ventana fija en Redis: `INCR` + `PEXPIRE` en un script atómico. La expiración es la de la
 * ventana del contador, no una caché de datos (no choca con la regla 5).
 *
 * - IPv4: una cuenta por IP. IPv6: una cuenta por /64, porque un mismo cliente puede rotar
 *   direcciones dentro de su prefijo (SLAAC, privacidad).
 * - Si Redis no responde, la petición pasa (se registra en el log): la página de corte es la que
 *   cobra y no debe caerse por el limitador.
 *
 * Variables (se leen en cada petición; `.env.example` de la API):
 * - `PORTAL_LIMITE_PETICIONES`: peticiones por ventana y por IP (30 por defecto; `0` lo apaga).
 * - `PORTAL_LIMITE_VENTANA_S`: largo de la ventana en segundos (60 por defecto).
 * - `PORTAL_REDIS_PREFIJO`: prefijo de las claves en Redis (`redis_portal.ts`).
 */

export interface ConfigLimite {
    peticiones: number
    ventanaS: number
    prefijo: string
}

export function configLimite(entorno: NodeJS.ProcessEnv = process.env): ConfigLimite {
    return {
        peticiones: enteroDeEntorno(entorno, 'PORTAL_LIMITE_PETICIONES', 30, 0),
        ventanaS: enteroDeEntorno(entorno, 'PORTAL_LIMITE_VENTANA_S', 60, 1),
        prefijo: prefijoRedisPortal(entorno),
    }
}

/** 429 con `Retry-After` (la cabecera la pone `limitarPorIp` antes de lanzar). */
export class DemasiadasPeticiones extends Problema {
    readonly reintentarEnS: number

    constructor(reintentarEnS: number) {
        super(
            429,
            'demasiadas_peticiones',
            'Demasiadas peticiones',
            `Superaste el límite de consultas desde tu conexión; intenta de nuevo en ${reintentarEnS} s`,
        )
        this.reintentarEnS = reintentarEnS
    }
}

/**
 * Clave del contador: la IPv4 tal cual; para IPv6, su /64 (`2001:db8:1:2::/64`).
 * Devuelve `null` si no es una IP.
 */
export function claveDeIp(ip: string): string | null {
    const familia = isIP(ip)
    if (familia === 4) return ip
    if (familia !== 6) return null
    const grupos = expandirIpv6(ip)
    return `${grupos.slice(0, 4).join(':')}::/64`
}

function expandirIpv6(ip: string): string[] {
    let texto = ip.toLowerCase()
    // IPv4 embebida al final (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`): dos grupos hex.
    const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(texto)
    if (v4) {
        const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number]
        texto = `${texto.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    }
    const [izquierda, derecha] = texto.split('::') as [string, string | undefined]
    const izq = izquierda ? izquierda.split(':') : []
    const der = derecha ? derecha.split(':') : []
    const ceros = derecha === undefined ? [] : Array<string>(8 - izq.length - der.length).fill('0')
    return [...izq, ...ceros, ...der].map((g) => g.replace(/^0+(?=.)/, ''))
}

export interface ResultadoLimite {
    permitido: boolean
    /** peticiones contadas en la ventana actual (incluida esta) */
    cuenta: number
    limite: number
    /** segundos hasta que se reinicia la ventana */
    reiniciaEnS: number
}

/** INCR atómico con expiración de la ventana; devuelve `{cuenta, pttl}`. */
const SCRIPT_CONTAR = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if n == 1 or ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {n, ttl}
`

export class LimitePeticiones {
    constructor(private readonly redis: Redis) {}

    /**
     * Cuenta una petición de `ip` para el endpoint `nombre`. Con `peticiones = 0` no cuenta nada.
     * Lanza si Redis falla; `limitarPorIp` decide dejar pasar.
     */
    async contar(nombre: string, ip: string, config: ConfigLimite): Promise<ResultadoLimite> {
        const clave = claveDeIp(ip)
        if (config.peticiones === 0 || !clave) {
            return { permitido: true, cuenta: 0, limite: config.peticiones, reiniciaEnS: 0 }
        }
        const ventanaMs = config.ventanaS * 1000
        const [cuenta, pttl] = (await this.redis.eval(
            SCRIPT_CONTAR,
            1,
            `${config.prefijo}:portal:limite:${nombre}:${clave}`,
            String(ventanaMs),
        )) as [number, number]
        return {
            permitido: cuenta <= config.peticiones,
            cuenta,
            limite: config.peticiones,
            reiniciaEnS: Math.max(1, Math.ceil(pttl / 1000)),
        }
    }
}

let compartido: LimitePeticiones | undefined

function limitador(): LimitePeticiones {
    compartido ??= new LimitePeticiones(redisPortal())
    return compartido
}

/**
 * Aplica el límite a la petición. Pone `RateLimit-Limit` y `RateLimit-Remaining`; al pasarse,
 * `Retry-After` y lanza `DemasiadasPeticiones` (429 problem+json).
 */
export async function limitarPorIp(
    ctx: HttpContext,
    nombre: string,
    ip: string,
    limite: LimitePeticiones = limitador(),
): Promise<void> {
    const config = configLimite()
    if (config.peticiones === 0) return

    let resultado: ResultadoLimite
    try {
        resultado = await limite.contar(nombre, ip, config)
    } catch (error) {
        logger.warn({ err: error, nombre }, 'No se pudo aplicar el límite del portal; la petición pasa')
        return
    }

    ctx.response.header('RateLimit-Limit', String(resultado.limite))
    ctx.response.header('RateLimit-Remaining', String(Math.max(0, resultado.limite - resultado.cuenta)))
    if (!resultado.permitido) {
        ctx.response.header('Retry-After', String(resultado.reiniciaEnS))
        throw new DemasiadasPeticiones(resultado.reiniciaEnS)
    }
}
