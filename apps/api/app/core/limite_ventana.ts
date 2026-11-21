import type { HttpContext } from '@adonisjs/core/http'
import { Problema } from '#shared/errores'
import { prefijoColas, redis } from '#shared/redis'

/**
 * Contador de ventana fija en Redis (`INCR` + `PEXPIRE` atómicos) para los límites del contrato Iris
 * 0.10.0: búsquedas de contactos (§3.5: 60 por minuto por token y 20 por actor) y cambios de titular
 * (§3.4.4: 2 por servicio y 10 por empresa y técnico al día; 5 `titular_no_coincide` por documento
 * en 24 h). La expiración es la de la ventana, no una caché de datos (no choca con la regla 5).
 *
 * Prefijo `<COLAS_PREFIJO>:limite` (cada agente de pruebas tiene el suyo).
 */

const SCRIPT_CONTAR = `
local n = redis.call('INCRBY', KEYS[1], ARGV[2])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {n, ttl}
`

export function claveLimite(...partes: Array<string | number>): string {
    return `${prefijoColas()}:limite:${partes.join(':')}`
}

export interface ResultadoLimite {
    cuenta: number
    reiniciaEnS: number
}

/** Suma `cuanto` (1 por defecto; 0 = solo leer) y devuelve la cuenta y los segundos que faltan. */
export async function contarEnVentana(clave: string, ventanaS: number, cuanto = 1): Promise<ResultadoLimite> {
    const [cuenta, pttl] = (await redis().eval(
        SCRIPT_CONTAR,
        1,
        clave,
        String(ventanaS * 1000),
        String(cuanto),
    )) as [number, number]
    return { cuenta: Number(cuenta), reiniciaEnS: Math.max(1, Math.ceil(Number(pttl) / 1000)) }
}

/** 429 con `Retry-After` (la cabecera la pone `exigirBajoLimite` antes de lanzar). */
export class LimiteExcedido extends Problema {
    constructor(
        codigo: string,
        titulo: string,
        detalle: string,
        readonly reintentarEnS: number,
    ) {
        super(429, codigo, titulo, detalle)
    }
}

/**
 * Cuenta una vez en cada clave y lanza 429 `codigo` (con `Retry-After`) si alguna pasó su tope.
 * `ctx` opcional: sin él (acciones) la cabecera la pone quien atrape el error.
 */
export async function exigirBajoLimite(
    limites: Array<{ clave: string; tope: number; ventanaS: number }>,
    error: { codigo: string; titulo: string; detalle: string },
    ctx?: HttpContext,
): Promise<void> {
    let peor: number | null = null
    for (const limite of limites) {
        const r = await contarEnVentana(limite.clave, limite.ventanaS)
        if (r.cuenta > limite.tope) peor = Math.max(peor ?? 0, r.reiniciaEnS)
    }
    if (peor === null) return
    ctx?.response.header('Retry-After', String(peor))
    throw new LimiteExcedido(error.codigo, error.titulo, error.detalle, peor)
}
