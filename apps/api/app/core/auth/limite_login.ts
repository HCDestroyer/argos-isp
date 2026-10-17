import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import { CredencialesInvalidas, Problema } from '#shared/errores'
import { prefijoColas, redis } from '#shared/redis'

/**
 * Límite de intentos de `POST /auth/login` (semana 3, revisión de seguridad), con dos contadores
 * de ventana fija en Redis (`INCR` + `PEXPIRE` atómicos; la expiración es la de la ventana, no una
 * caché de datos: no choca con la regla 5):
 *
 * - **Por IP** (`ctx.request.ip()`): cuenta todos los intentos. Frena a quien prueba muchas cuentas
 *   desde un mismo origen. Por defecto 30 por ventana.
 * - **Por usuario** (correo en minúsculas, guardado como hash): cuenta solo los intentos
 *   fallidos y se reinicia con un login correcto. Frena la fuerza bruta contra una cuenta aunque
 *   cambie la IP. Por defecto 5 por ventana.
 *
 * Al pasarse: 429 problem+json (`demasiados_intentos`) con `Retry-After`, sin verificar la
 * contraseña (así no se puede seguir probando). Si Redis no responde, el login sigue (se registra
 * en el log): un Redis caído no debe dejar a nadie fuera del panel.
 *
 * Variables (se leen en cada petición; `.env.example`): `LOGIN_LIMITE_IP` (30),
 * `LOGIN_LIMITE_USUARIO` (5), `LOGIN_LIMITE_VENTANA_S` (900); `0` apaga ese contador.
 * `LOGIN_LIMITE_PREFIJO`: prefijo de las claves (por defecto `<COLAS_PREFIJO>:login`).
 */

export interface ConfigLimiteLogin {
    porIp: number
    porUsuario: number
    ventanaS: number
    prefijo: string
}

function entero(entorno: NodeJS.ProcessEnv, nombre: string, defecto: number, minimo: number): number {
    const crudo = entorno[nombre]
    if (crudo === undefined || crudo.trim() === '') return defecto
    const valor = Number(crudo)
    return Number.isInteger(valor) && valor >= minimo ? valor : defecto
}

export function configLimiteLogin(entorno: NodeJS.ProcessEnv = process.env): ConfigLimiteLogin {
    return {
        porIp: entero(entorno, 'LOGIN_LIMITE_IP', 30, 0),
        porUsuario: entero(entorno, 'LOGIN_LIMITE_USUARIO', 5, 0),
        ventanaS: entero(entorno, 'LOGIN_LIMITE_VENTANA_S', 900, 1),
        prefijo: entorno.LOGIN_LIMITE_PREFIJO || `${prefijoColas()}:login`,
    }
}

export class DemasiadosIntentos extends Problema {
    readonly reintentarEnS: number

    constructor(reintentarEnS: number, motivo: 'ip' | 'usuario') {
        super(
            429,
            'demasiados_intentos',
            'Demasiados intentos de inicio de sesión',
            motivo === 'usuario'
                ? `Demasiados intentos fallidos con esta cuenta; intenta de nuevo en ${reintentarEnS} s`
                : `Demasiados intentos desde tu conexión; intenta de nuevo en ${reintentarEnS} s`,
        )
        this.reintentarEnS = reintentarEnS
    }
}

const SCRIPT_CONTAR = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if n == 1 or ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {n, ttl}
`

const segundos = (pttl: number) => Math.max(1, Math.ceil(pttl / 1000))

export class LimiteLogin {
    constructor(
        private readonly conexion: () => Redis = redis,
        private readonly config: () => ConfigLimiteLogin = configLimiteLogin,
    ) {}

    #claveIp(c: ConfigLimiteLogin, ip: string) {
        return `${c.prefijo}:ip:${ip}`
    }

    #claveUsuario(c: ConfigLimiteLogin, email: string) {
        const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)
        return `${c.prefijo}:usuario:${hash}`
    }

    /** Cuenta el intento de la IP y revisa los fallidos del usuario; lanza 429 si se pasó alguno. */
    async antes(ctx: HttpContext, email: string): Promise<void> {
        await this.contarIp(ctx)
        await this.revisarUsuario(ctx, email)
    }

    /** Cuenta el intento de la IP (una vez por petición); 429 si se pasó. */
    async contarIp(ctx: HttpContext): Promise<void> {
        if (IP_CONTADA.has(ctx)) return
        IP_CONTADA.add(ctx)
        const c = this.config()
        if (c.porIp > 0) {
            const [n, pttl] = (await this.conexion().eval(
                SCRIPT_CONTAR,
                1,
                this.#claveIp(c, ctx.request.ip()),
                String(c.ventanaS * 1000),
            )) as [number, number]
            ctx.response.header('RateLimit-Limit', String(c.porIp))
            ctx.response.header('RateLimit-Remaining', String(Math.max(0, c.porIp - n)))
            if (n > c.porIp) this.#rechazar(ctx, segundos(pttl), 'ip')
        }
    }

    /** Revisa los intentos fallidos del usuario; 429 si se pasó. */
    async revisarUsuario(ctx: HttpContext, email: string): Promise<void> {
        const c = this.config()
        const r = this.conexion()
        if (c.porUsuario > 0) {
            const clave = this.#claveUsuario(c, email)
            const [valor, pttl] = await Promise.all([r.get(clave), r.pttl(clave)])
            if (Number(valor ?? 0) >= c.porUsuario) this.#rechazar(ctx, segundos(pttl), 'usuario')
        }
    }

    async fallido(email: string): Promise<void> {
        const c = this.config()
        if (c.porUsuario === 0) return
        await this.conexion().eval(SCRIPT_CONTAR, 1, this.#claveUsuario(c, email), String(c.ventanaS * 1000))
    }

    async correcto(email: string): Promise<void> {
        const c = this.config()
        if (c.porUsuario === 0) return
        await this.conexion().del(this.#claveUsuario(c, email))
    }

    #rechazar(ctx: HttpContext, reintentarEnS: number, motivo: 'ip' | 'usuario'): never {
        ctx.response.header('Retry-After', String(reintentarEnS))
        throw new DemasiadosIntentos(reintentarEnS, motivo)
    }
}

/** Peticiones cuya IP ya contó el gancho `antes` de la ruta (no se cuenta dos veces). */
const IP_CONTADA = new WeakSet<HttpContext>()

let compartido: LimiteLogin | undefined

/** Errores de Redis: se registran y la petición pasa; el 429 sí sale. */
async function seguro(paso: () => Promise<void>) {
    try {
        await paso()
    } catch (error) {
        if (error instanceof DemasiadosIntentos) throw error
        logger.warn({ err: error }, 'No se pudo aplicar el límite de login; la petición pasa')
    }
}

/**
 * Gancho `antes` de las rutas de login (`DefinicionRuta.antes`): cuenta el intento de la IP antes
 * de validar el cuerpo, así un cuerpo inválido (422) también consume el cupo.
 */
export function contarIpLogin(limite?: LimiteLogin) {
    return (ctx: HttpContext) => seguro(() => (limite ?? (compartido ??= new LimiteLogin())).contarIp(ctx))
}

/**
 * Envuelve el login con el límite. Los errores de Redis se registran y no bloquean; el 429 y los
 * errores del login sí salen.
 */
export async function conLimiteLogin<T>(
    ctx: HttpContext,
    email: string,
    login: () => Promise<T>,
    limite: LimiteLogin = (compartido ??= new LimiteLogin()),
): Promise<T> {
    await seguro(() => limite.antes(ctx, email))
    try {
        const resultado = await login()
        await seguro(() => limite.correcto(email))
        return resultado
    } catch (error) {
        if (error instanceof CredencialesInvalidas) await seguro(() => limite.fallido(email))
        throw error
    }
}
