import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'

/**
 * IPAM IPv4: asignación de IPs de las redes de un router a servicios, con historial en
 * `network.ipv4_asignaciones` (`inicio`/`fin`; vigente = `fin IS NULL`). Una IP vigente pertenece
 * a un solo servicio (índice único) y un servicio tiene a lo sumo una IPv4 vigente.
 *
 * Se usa dentro de las acciones de servicios (misma transacción). La asignación automática toma
 * la primera IP libre del router, primero en redes `estatico` y luego en `pool`, sin la dirección
 * de red, broadcast ni gateway. Un advisory lock por router serializa asignaciones concurrentes.
 */

export interface Ipv4Asignada {
    ip: string
    red_id: number
}

async function bloquearRouter(trx: TransactionClientContract, routerId: number) {
    await trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v4:router:' || ?::text))`, [routerId])
}

export async function ipv4Vigente(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<Ipv4Asignada | null> {
    const fila = (await trx
        .from('network.ipv4_asignaciones')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        .select(trx.raw('host(ip) AS ip'), 'red_id')
        .first()) as Ipv4Asignada | null
    return fila
}

/** Cierra la asignación vigente del servicio (si hay). Devuelve la IP liberada. */
export async function liberarIpv4(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<string | null> {
    const filas = (await trx
        .from('network.ipv4_asignaciones')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        // inet de host (/32) sale sin máscara: "10.0.0.5"
        .update({ fin: trx.knexRawQuery('now()') } as Record<string, unknown>, ['ip'])) as Array<{
        ip: string
    }>
    return filas[0]?.ip ?? null
}

/**
 * Asigna una IPv4 al servicio en el router: la pedida (`ip`) o la primera libre. Si el servicio ya
 * tiene esa misma IP vigente en el router, la conserva. Lanza 422 si no hay IPs o la IP no es de
 * una red del router, y 409 si está ocupada por otro servicio.
 */
export async function asignarIpv4(
    trx: TransactionClientContract,
    entrada: { servicioId: number; routerId: number; ip?: string | null },
): Promise<Ipv4Asignada> {
    await bloquearRouter(trx, entrada.routerId)
    const actual = await ipv4Vigente(trx, entrada.servicioId)

    if (entrada.ip) {
        const { rows } = (await trx.rawQuery(
            `SELECT r.id, masklen(r.cidr) < 31 AND host(network(r.cidr)) = host(?::inet) AS es_red,
                    masklen(r.cidr) < 31 AND host(broadcast(r.cidr)) = host(?::inet) AS es_broadcast,
                    r.gateway IS NOT NULL AND host(r.gateway) = host(?::inet) AS es_gateway
               FROM network.redes_ipv4 r
              WHERE r.router_id = ? AND r.cidr >>= ?::inet`,
            [entrada.ip, entrada.ip, entrada.ip, entrada.routerId, entrada.ip],
        )) as { rows: Array<{ id: number; es_red: boolean; es_broadcast: boolean; es_gateway: boolean }> }
        const red = rows[0]
        if (!red) {
            throw new ValidacionFallida(
                [{ field: 'ipv4', message: 'La IP no pertenece a ninguna red IPv4 del router', rule: 'red' }],
                'La IP no pertenece a ninguna red IPv4 del router',
            )
        }
        const reservada = red.es_red || red.es_broadcast || red.es_gateway
        if (reservada) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'ipv4',
                        message: 'Es la dirección de red, broadcast o gateway',
                        rule: 'reservada',
                    },
                ],
                'La IP es la dirección de red, broadcast o gateway',
            )
        }
        if (actual && actual.ip === entrada.ip && actual.red_id === red.id) return actual

        const ocupada = (await trx
            .from('network.ipv4_asignaciones')
            .whereRaw('ip = ?::inet', [entrada.ip])
            .whereNull('fin')
            .select('servicio_id')
            .first()) as { servicio_id: number } | null
        if (ocupada) {
            throw new Conflicto(
                `La IP ${entrada.ip} ya está asignada al servicio ${ocupada.servicio_id}`,
                'ip_ocupada',
            )
        }
        if (actual) await liberarIpv4(trx, entrada.servicioId)
        await trx
            .insertQuery()
            .table('network.ipv4_asignaciones')
            .insert({ servicio_id: entrada.servicioId, red_id: red.id, ip: entrada.ip })
        return { ip: entrada.ip, red_id: red.id }
    }

    if (actual) {
        const enRouter = await trx
            .from('network.redes_ipv4')
            .where('id', actual.red_id)
            .where('router_id', entrada.routerId)
            .first()
        if (enRouter) return actual
        await liberarIpv4(trx, entrada.servicioId)
    }

    const { rows } = (await trx.rawQuery(
        `SELECT r.id AS red_id, host(set_masklen(network(r.cidr)::inet, 32) + g.n) AS ip
           FROM network.redes_ipv4 r
           CROSS JOIN LATERAL generate_series(
                CASE WHEN masklen(r.cidr) >= 31 THEN 0 ELSE 1 END::bigint,
                CASE WHEN masklen(r.cidr) >= 31 THEN (2::bigint ^ (32 - masklen(r.cidr)))::bigint - 1
                     ELSE (2::bigint ^ (32 - masklen(r.cidr)))::bigint - 2 END
           ) AS g(n)
          WHERE r.router_id = ?
            AND (r.gateway IS NULL OR set_masklen(network(r.cidr)::inet, 32) + g.n <> set_masklen(r.gateway, 32))
            AND NOT EXISTS (
                SELECT 1 FROM network.ipv4_asignaciones a
                 WHERE a.fin IS NULL AND a.ip = set_masklen(network(r.cidr)::inet, 32) + g.n
            )
          ORDER BY (r.tipo = 'estatico') DESC, r.id, g.n
          LIMIT 1`,
        [entrada.routerId],
    )) as { rows: Array<{ red_id: number; ip: string }> }
    const libre = rows[0]
    if (!libre) {
        throw new ReglaNegocio('El router no tiene IPv4 libres en sus redes', 'sin_ipv4_libres')
    }
    await trx
        .insertQuery()
        .table('network.ipv4_asignaciones')
        .insert({ servicio_id: entrada.servicioId, red_id: libre.red_id, ip: libre.ip })
    return libre
}
