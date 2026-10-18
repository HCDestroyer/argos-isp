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

/**
 * Candidatos de una IP `q.v` (sesiones activas y asignaciones vigentes), el ganador por prefijo
 * más largo. Va dentro de un `LATERAL` sobre las IPs pedidas: una sola consulta para 1 o 500 IPs,
 * cada rama usa los índices de `network.sesiones` y de las asignaciones (gist para `>>=`).
 */
const GANADOR = `
    SELECT c.servicio_id, c.prefijo::text AS prefijo, c.inicio
    FROM (
        SELECT se.servicio_id, set_masklen(se.ipv4, 32)::cidr AS prefijo, 0 AS fuente, se.inicio, se.id
        FROM network.sesiones se
        WHERE se.fin IS NULL AND se.servicio_id IS NOT NULL AND family(q.v) = 4 AND se.ipv4 = q.v
        UNION ALL
        SELECT se.servicio_id, se.prefijo_enlace_v6, 0, se.inicio, se.id
        FROM network.sesiones se
        WHERE se.fin IS NULL AND se.servicio_id IS NOT NULL AND se.prefijo_enlace_v6 >>= q.v
        UNION ALL
        SELECT se.servicio_id, se.prefijo_delegado_v6, 0, se.inicio, se.id
        FROM network.sesiones se
        WHERE se.fin IS NULL AND se.servicio_id IS NOT NULL AND se.prefijo_delegado_v6 >>= q.v
        UNION ALL
        SELECT a.servicio_id, set_masklen(a.ip, 32)::cidr, 1, a.inicio, a.id
        FROM network.ipv4_asignaciones a
        WHERE a.fin IS NULL AND family(q.v) = 4 AND a.ip = q.v
        UNION ALL
        SELECT a.servicio_id, a.prefijo, 1, a.inicio, a.id
        FROM network.ipv6_asignaciones a
        WHERE a.fin IS NULL AND a.prefijo >>= q.v
    ) c
    ORDER BY masklen(c.prefijo) DESC, c.fuente ASC, c.inicio DESC, c.id DESC
    LIMIT 1
`

const SQL = `
SELECT q.i, g.servicio_id, sv.cliente_id, g.prefijo, g.inicio AS desde,
       sv.user_ppp, sv.estado, sv.router_id, sv.empresa_id,
       pl.nombre AS plan, cl.nombre AS cliente_nombre, cl.codigo AS cliente_codigo,
       cl.tipo AS cliente_tipo, cl.zona_id, em.nombre_comercial AS empresa_nombre, em.nit AS empresa_nit
FROM unnest(?::inet[]) WITH ORDINALITY AS q (v, i)
CROSS JOIN LATERAL (${GANADOR}) g
JOIN core.servicios sv ON sv.id = g.servicio_id
JOIN core.clientes cl ON cl.id = sv.cliente_id
JOIN network.planes pl ON pl.id = sv.plan_id
JOIN core.empresas em ON em.id = sv.empresa_id
`

/** Resolución con los datos del servicio, el cliente y la empresa (resolver de Horus, §2.1). */
export interface ResolucionIpDetalle extends ResolucionIp {
    /** inicio de la sesión o asignación que contiene la IP */
    desde: Date
    user_ppp: string | null
    estado: string
    router_id: number
    empresa_id: number
    plan: string
    cliente_nombre: string
    cliente_codigo: string
    cliente_tipo: string
    zona_id: number | null
    empresa_nombre: string
    empresa_nit: string | null
}

function validarIp(ip: string, campo = 'ip'): string {
    const texto = ip.trim()
    if (isIP(texto) === 0) {
        throw new ValidacionFallida([{ field: campo, message: 'Debe ser una IPv4 o IPv6', rule: 'ip' }])
    }
    return texto
}

/**
 * Resuelve varias IPs en una sola consulta (sin N+1). Devuelve un arreglo del mismo largo y orden
 * que `ips`: la resolución de cada una o null. 422 si alguna no es una IP.
 */
export async function resolverIps(
    ips: string[],
    cliente: QueryClientContract = db.connection(),
): Promise<Array<ResolucionIpDetalle | null>> {
    const textos = ips.map((ip, i) => validarIp(ip, `ips.${i}`))
    const salida: Array<ResolucionIpDetalle | null> = textos.map(() => null)
    if (textos.length === 0) return salida
    const resultado = await cliente.rawQuery(SQL, [textos])
    for (const fila of resultado.rows as Array<Record<string, unknown>>) {
        salida[Number(fila.i) - 1] = {
            servicio_id: Number(fila.servicio_id),
            cliente_id: Number(fila.cliente_id),
            prefijo: String(fila.prefijo),
            desde: fila.desde as Date,
            user_ppp: (fila.user_ppp as string | null) ?? null,
            estado: String(fila.estado),
            router_id: Number(fila.router_id),
            empresa_id: Number(fila.empresa_id),
            plan: String(fila.plan),
            cliente_nombre: String(fila.cliente_nombre),
            cliente_codigo: String(fila.cliente_codigo),
            cliente_tipo: String(fila.cliente_tipo),
            zona_id: fila.zona_id === null ? null : Number(fila.zona_id),
            empresa_nombre: String(fila.empresa_nombre),
            empresa_nit: (fila.empresa_nit as string | null) ?? null,
        }
    }
    return salida
}

/** null si ninguna sesión ni asignación vigente contiene la IP. 422 si no es una IP. */
export async function resolverIp(
    ip: string,
    cliente: QueryClientContract = db.connection(),
): Promise<ResolucionIp | null> {
    const [fila] = await resolverIps([validarIp(ip)], cliente)
    if (!fila) return null
    return { servicio_id: fila.servicio_id, cliente_id: fila.cliente_id, prefijo: fila.prefijo }
}
