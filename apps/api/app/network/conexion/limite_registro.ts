import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { Problema } from '#shared/errores'
import { prefijoColas, redis } from '#shared/redis'

/**
 * Límite por IP de `POST /routers/conexion/registrar` (público, con token). Ventana fija en Redis
 * (`INCR` + `PEXPIRE` atómicos; la expiración es la del contador, no una caché). Cuenta todos los
 * intentos, también los de cuerpo inválido (gancho `antes`). Si Redis no responde, la petición pasa
 * y se registra en el log: el token sigue siendo de un uso y con hash.
 *
 * Variables: `ROUTERS_REGISTRO_LIMITE` (10 por ventana; `0` lo apaga), `ROUTERS_REGISTRO_VENTANA_S`
 * (900), `ROUTERS_REGISTRO_PREFIJO` (por defecto `<COLAS_PREFIJO>:routers-registro`).
 */

export class DemasiadosRegistros extends Problema {
    constructor(readonly reintentarEnS: number) {
        super(
            429,
            'demasiadas_peticiones',
            'Demasiadas peticiones',
            `Demasiados intentos de registro desde esta IP; intenta de nuevo en ${reintentarEnS} s`,
        )
    }
}

function entero(valor: string | undefined, defecto: number, minimo: number): number {
    if (valor === undefined || valor.trim() === '') return defecto
    const n = Number(valor)
    return Number.isInteger(n) && n >= minimo ? n : defecto
}

export function configLimiteRegistro(entorno: NodeJS.ProcessEnv = process.env) {
    return {
        limite: entero(entorno.ROUTERS_REGISTRO_LIMITE, 10, 0),
        ventanaS: entero(entorno.ROUTERS_REGISTRO_VENTANA_S, 900, 1),
        prefijo: entorno.ROUTERS_REGISTRO_PREFIJO || `${prefijoColas()}:routers-registro`,
    }
}

const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if n == 1 or ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {n, ttl}
`

export async function limitarRegistro(ctx: HttpContext): Promise<void> {
    const c = configLimiteRegistro()
    if (c.limite === 0) return
    let n: number
    let pttl: number
    try {
        ;[n, pttl] = (await redis().eval(
            SCRIPT,
            1,
            `${c.prefijo}:${ctx.request.ip()}`,
            String(c.ventanaS * 1000),
        )) as [number, number]
    } catch (error) {
        logger.warn({ err: error }, 'No se pudo aplicar el límite del registro de routers; la petición pasa')
        return
    }
    ctx.response.header('RateLimit-Limit', String(c.limite))
    ctx.response.header('RateLimit-Remaining', String(Math.max(0, c.limite - n)))
    if (n > c.limite) {
        const segundos = Math.max(1, Math.ceil(pttl / 1000))
        ctx.response.header('Retry-After', String(segundos))
        throw new DemasiadosRegistros(segundos)
    }
}
