import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio } from '#shared/errores'
import type { RedTunel } from '#network/conexion/config'

/**
 * IPAM del túnel WireGuard: una /32 por router dentro de `ARGOSISP_WG_RED`.
 *
 * - Se asigna una sola vez (al crear la fila de `network.routers_conexion`) y no cambia mientras el
 *   router exista: rotar la conexión conserva la IP.
 * - Se toma la menor libre desde la `.2` (la `.1` es el servidor; la de red y la de broadcast nunca).
 * - Se salta una IP que ya sea `nas_ip` de otro router: al registrarse, la IP del túnel pasa a ser su
 *   `nas_ip` (FreeRADIUS reconoce al NAS por la IP de origen), que es única.
 * - Un candado de transacción (`pg_advisory_xact_lock`) serializa las asignaciones; la restricción
 *   única de `ip_tunel` es la última defensa.
 */

const CANDADO = 'network.routers_conexion.ip_tunel'

export class RedTunelLlena extends ReglaNegocio {
    constructor(red: string) {
        super(`No quedan IPs libres en la red del túnel ${red} (ARGOSISP_WG_RED)`, 'red_tunel_llena')
    }
}

export async function asignarIpTunel(trx: TransactionClientContract, red: RedTunel): Promise<string> {
    await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [CANDADO])
    const ultimo = 2 ** (32 - red.prefijo) - 2
    const base = red.cidr.split('/')[0]!
    const { rows } = (await trx.rawQuery(
        `SELECT host(b.ip + n) AS ip
           FROM (SELECT ?::inet AS ip) b, generate_series(2, ?::bigint) AS n
          WHERE NOT EXISTS (SELECT 1 FROM network.routers_conexion c WHERE c.ip_tunel = b.ip + n)
            AND NOT EXISTS (SELECT 1 FROM network.routers r WHERE r.nas_ip = b.ip + n)
          ORDER BY n
          LIMIT 1`,
        [base, ultimo],
    )) as { rows: Array<{ ip: string }> }
    const ip = rows[0]?.ip
    if (!ip) throw new RedTunelLlena(red.cidr)
    return ip
}
