import type { Redis } from 'ioredis'
import type { UltimoConocido } from './ultimo_conocido.ts'

/**
 * Bajas definitivas (`contratos/eliminar.md`): `servicio.eliminado` y `router.eliminado`.
 *
 * La autorización en caché de un servicio que ya no existe tiene que dejar de servir en cada nodo
 * `aaa`, por evento y nunca por TTL (CLAUDE.md regla 5). Hay dos copias:
 *
 *   1. Redis `aaa:user:<user_ppp>`. A1 escribe la lápida al borrar el servicio (write-through
 *      después del COMMIT). Si esa escritura falló (Redis caído en ese instante) la clave seguiría
 *      con el registro completo y `aaa` aceptaría al usuario: aquí se reemplaza por la lápida.
 *      Para un router eliminado, toda clave con ese `router_id` (no debería haber: sin historial
 *      implica sin servicios, ni retirados) queda igual como lápida.
 *   2. El último perfil conocido de este nodo (modo degradado, en memoria y en su archivo): se
 *      olvidan los registros del servicio o del router, para que una caída de Redis y de la API no
 *      vuelva a aceptar a un usuario eliminado.
 *
 * Lápida, no `DEL` (`contratos/aaa.md`): un `DEL` competiría con un `SET NX` de una lectura vieja de
 * la API. La lápida lleva `servicio_id` y `version + 1` como la de A1, así que el SET condicionado
 * de A1 no la pisa con datos viejos. El reemplazo es atómico (script Lua): solo si la clave sigue
 * con el mismo valor que se leyó; si A1 escribió entre medio, gana A1.
 *
 * Idempotente: una segunda entrega encuentra lápidas y nada en memoria, y no cambia nada.
 */

export type CriterioBaja = { servicioId: number } | { routerId: number }

export interface ResultadoBaja {
    /** `user_ppp` cuyas claves se reemplazaron por lápida */
    lapidas: string[]
    /** registros olvidados del último perfil conocido */
    olvidados: number
}

/** Reemplaza KEYS[1] por ARGV[2] solo si sigue valiendo ARGV[1]. */
const SCRIPT_REEMPLAZAR = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
end
return 0
`

interface Crudo {
    eliminado?: unknown
    user_ppp?: unknown
    servicio_id?: unknown
    router_id?: unknown
    version?: unknown
}

function coincide(v: Crudo, criterio: CriterioBaja): boolean {
    if ('servicioId' in criterio) return Number(v.servicio_id) === criterio.servicioId
    return Number(v.router_id) === criterio.routerId
}

export interface OpcionesBaja {
    redis: Redis
    /** `AAA_REDIS_PREFIJO` (por defecto `aaa:user:`) */
    prefijo: string
    ultimoConocido?: UltimoConocido
    lote?: number
}

export async function aplicarBaja(opciones: OpcionesBaja, criterio: CriterioBaja): Promise<ResultadoBaja> {
    const { redis, prefijo, ultimoConocido, lote = 500 } = opciones
    const resultado: ResultadoBaja = { lapidas: [], olvidados: 0 }

    // Primero Redis: si el espejo del modo degradado corre después, copia la lápida y no el registro.
    let cursor = '0'
    do {
        const [siguiente, claves] = await redis.scan(cursor, 'MATCH', `${prefijo}*`, 'COUNT', lote)
        cursor = siguiente
        if (claves.length === 0) continue
        const valores = await redis.mget(...claves)
        for (let i = 0; i < claves.length; i++) {
            const crudo = valores[i]
            if (crudo === null || crudo === undefined) continue
            let v: Crudo
            try {
                v = JSON.parse(crudo) as Crudo
            } catch {
                continue
            }
            if (typeof v !== 'object' || v === null || v.eliminado === true || !coincide(v, criterio)) continue
            const userPpp = typeof v.user_ppp === 'string' ? v.user_ppp : claves[i]!.slice(prefijo.length)
            const lapida = JSON.stringify({
                eliminado: true,
                user_ppp: userPpp,
                servicio_id: Number(v.servicio_id),
                version: (Number.isInteger(v.version) ? Number(v.version) : 0) + 1,
            })
            const r = (await redis.eval(SCRIPT_REEMPLAZAR, 1, claves[i]!, crudo, lapida)) as number
            if (r === 1) resultado.lapidas.push(userPpp)
        }
    } while (cursor !== '0')

    if (ultimoConocido) {
        resultado.olvidados = ultimoConocido.olvidarDonde((r) =>
            'servicioId' in criterio ? r.servicio_id === criterio.servicioId : r.router_id === criterio.routerId,
        )
        if (resultado.olvidados > 0) await ultimoConocido.volcar()
    }
    return resultado
}
