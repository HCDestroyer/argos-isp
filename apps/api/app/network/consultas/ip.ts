import { isIP } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida } from '#shared/errores'

/**
 * Resolución de una IP a su servicio (tarea 13): `GET /ip/{ip}`. La usan la página de corte (A5)
 * y, en fase 2, Horus.
 *
 * Candidatos, todos vigentes (`fin IS NULL`):
 * - `network.sesiones` activas: `ipv4` igual o IPv6 dentro de `prefijo_enlace_v6` /
 *   `prefijo_delegado_v6`;
 * - `network.ipv4_asignaciones` (`ip` igual) y `network.ipv6_asignaciones` (`prefijo >>= ip`).
 *
 * Gana el **prefijo más largo**; a igual longitud, la sesión activa (lo que el router tiene
 * ahora) sobre la asignación, y la más reciente. Una IPv4 cuenta como /32.
 */

export interface ResolucionIp {
    servicio_id: number
    cliente_id: number
    /** asignación o sesión que contiene la IP, en notación CIDR */
    prefijo: string
}

const SQL = `
WITH q AS (SELECT ?::inet AS v)
SELECT c.servicio_id, sv.cliente_id, c.prefijo::text AS prefijo
FROM (
    SELECT se.servicio_id, set_masklen(se.ipv4, 32)::cidr AS prefijo, 0 AS fuente, se.inicio, se.id
    FROM network.sesiones se, q
    WHERE se.fin IS NULL AND se.servicio_id IS NOT NULL AND family(q.v) = 4 AND se.ipv4 = q.v
    UNION ALL
    SELECT se.servicio_id, se.prefijo_enlace_v6, 0, se.inicio, se.id
    FROM network.sesiones se, q
    WHERE se.fin IS NULL AND se.servicio_id IS NOT NULL AND se.prefijo_enlace_v6 >>= q.v
    UNION ALL
    SELECT se.servicio_id, se.prefijo_delegado_v6, 0, se.inicio, se.id
    FROM network.sesiones se, q
    WHERE se.fin IS NULL AND se.servicio_id IS NOT NULL AND se.prefijo_delegado_v6 >>= q.v
    UNION ALL
    SELECT a.servicio_id, set_masklen(a.ip, 32)::cidr, 1, a.inicio, a.id
    FROM network.ipv4_asignaciones a, q
    WHERE a.fin IS NULL AND family(q.v) = 4 AND a.ip = q.v
    UNION ALL
    SELECT a.servicio_id, a.prefijo, 1, a.inicio, a.id
    FROM network.ipv6_asignaciones a, q
    WHERE a.fin IS NULL AND a.prefijo >>= q.v
) c
JOIN core.servicios sv ON sv.id = c.servicio_id
ORDER BY masklen(c.prefijo) DESC, c.fuente ASC, c.inicio DESC, c.id DESC
LIMIT 1
`

/** null si ninguna sesión ni asignación vigente contiene la IP. 422 si no es una IP. */
export async function resolverIp(
    ip: string,
    cliente: QueryClientContract = db.connection(),
): Promise<ResolucionIp | null> {
    const texto = ip.trim()
    if (isIP(texto) === 0) {
        throw new ValidacionFallida([{ field: 'ip', message: 'Debe ser una IPv4 o IPv6', rule: 'ip' }])
    }
    const resultado = await cliente.rawQuery(SQL, [texto])
    const fila = (resultado.rows as ResolucionIp[])[0]
    if (!fila) return null
    return {
        servicio_id: Number(fila.servicio_id),
        cliente_id: Number(fila.cliente_id),
        prefijo: fila.prefijo,
    }
}
