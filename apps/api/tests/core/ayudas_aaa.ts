import { redis } from '#shared/redis'
import { prefijoAaa } from '#core/aaa'

/** La base de pruebas se recrea en cada corrida (ids y user_ppp se repiten): se limpia el prefijo. */
export async function limpiarClavesAaa() {
    const patron = `${prefijoAaa()}*`
    let cursor = '0'
    do {
        const [siguiente, claves] = await redis().scan(cursor, 'MATCH', patron, 'COUNT', 500)
        if (claves.length > 0) await redis().del(...claves)
        cursor = siguiente
    } while (cursor !== '0')
}
