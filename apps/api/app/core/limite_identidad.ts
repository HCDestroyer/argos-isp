import type { Redis } from 'ioredis'
import { Problema } from '#shared/errores'
import { prefijoColas, redis } from '#shared/redis'

/**
 * Límite de `clientes.verificar_identidad` (contrato Iris 0.6.0 §7.5): 5 intentos **fallidos** por
 * cliente cada 30 minutos, con un solo contador en Redis por cliente (ventana fija: `INCR` +
 * `PEXPIRE` atómicos; la expiración es la de la ventana, no una caché de datos, así que no choca
 * con la regla 5). Al llegar al tope, todo intento sobre ese cliente responde
 * `429 demasiados_intentos` con `Retry-After` hasta que vence la ventana.
 *
 * - Un acierto **no** reinicia el contador: si lo hiciera, acertar una prueba débil (el nombre, que
 *   Iris ya tiene) abriría cupo para seguir probando documentos.
 * - `422 metodo_no_disponible` no cuenta (no se comparó nada).
 * - Si Redis no responde, la verificación falla (503): sin contador no hay límite, y aquí el límite
 *   es lo que impide adivinar el documento.
 *
 * Variables (se leen en cada intento; `.env.example`): `IDENTIDAD_LIMITE_INTENTOS` (5),
 * `IDENTIDAD_LIMITE_VENTANA_S` (1800), `IDENTIDAD_LIMITE_PREFIJO` (por defecto
 * `<COLAS_PREFIJO>:identidad`).
 */

export interface ConfigLimiteIdentidad {
    intentos: number
    ventanaS: number
    prefijo: string
}

function entero(entorno: NodeJS.ProcessEnv, nombre: string, defecto: number): number {
    const crudo = entorno[nombre]
    if (crudo === undefined || crudo.trim() === '') return defecto
    const valor = Number(crudo)
    return Number.isInteger(valor) && valor >= 1 ? valor : defecto
}

export function configLimiteIdentidad(entorno: NodeJS.ProcessEnv = process.env): ConfigLimiteIdentidad {
    return {
        intentos: entero(entorno, 'IDENTIDAD_LIMITE_INTENTOS', 5),
        ventanaS: entero(entorno, 'IDENTIDAD_LIMITE_VENTANA_S', 1800),
        prefijo: entorno.IDENTIDAD_LIMITE_PREFIJO || `${prefijoColas()}:identidad`,
    }
}

export class DemasiadosIntentosIdentidad extends Problema {
    constructor(readonly reintentarEnS: number) {
        super(
            429,
            'demasiados_intentos',
            'Demasiados intentos de verificación',
            `Demasiados intentos fallidos de verificar a este cliente; intenta de nuevo en ${reintentarEnS} s`,
        )
    }
}

export class LimiteNoDisponible extends Problema {
    constructor() {
        super(
            503,
            'limite_no_disponible',
            'Verificación no disponible',
            'No se pudo leer el contador de intentos; intenta de nuevo en unos minutos',
        )
    }
}

const SCRIPT_CONTAR = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if n == 1 or ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`

const segundos = (pttl: number, ventanaS: number) =>
    pttl > 0 ? Math.max(1, Math.ceil(pttl / 1000)) : ventanaS

export function claveLimiteIdentidad(clienteId: number, config = configLimiteIdentidad()): string {
    return `${config.prefijo}:cliente:${clienteId}`
}

export class LimiteIdentidad {
    constructor(
        private readonly conexion: () => Redis = redis,
        private readonly config: () => ConfigLimiteIdentidad = configLimiteIdentidad,
    ) {}

    /** 429 si el cliente ya agotó los intentos fallidos de la ventana; 503 si Redis falla. */
    async revisar(clienteId: number): Promise<void> {
        const c = this.config()
        const clave = claveLimiteIdentidad(clienteId, c)
        let valor: string | null
        let pttl: number
        try {
            const r = this.conexion()
            ;[valor, pttl] = await Promise.all([r.get(clave), r.pttl(clave)])
        } catch {
            throw new LimiteNoDisponible()
        }
        if (Number(valor ?? 0) >= c.intentos) {
            throw new DemasiadosIntentosIdentidad(segundos(pttl, c.ventanaS))
        }
    }

    /** Cuenta un intento fallido. */
    async fallido(clienteId: number): Promise<void> {
        const c = this.config()
        try {
            await this.conexion().eval(
                SCRIPT_CONTAR,
                1,
                claveLimiteIdentidad(clienteId, c),
                String(c.ventanaS * 1000),
            )
        } catch {
            throw new LimiteNoDisponible()
        }
    }
}
