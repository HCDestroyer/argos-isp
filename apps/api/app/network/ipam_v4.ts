import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { sqlLimitesRedV4 } from '#network/ocupacion'

/**
 * IPAM IPv4: asignación de IPs de las redes de un router a servicios, con historial en
 * `network.ipv4_asignaciones` (`inicio`/`fin`; vigente = `fin IS NULL`). Una IP vigente pertenece
 * a un solo servicio (índice único) y un servicio tiene a lo sumo una IPv4 vigente.
 *
 * Se usa dentro de las acciones de servicios (misma transacción). La asignación automática toma
 * la primera IP libre del router, primero en redes `estatico` y luego en `pool`, dentro del rango
 * de la red (`rango_inicio`–`rango_fin`; sin rango, toda la red) y sin la dirección de red,
 * broadcast ni gateway. Una IP pedida a mano también debe caer dentro del rango. Un advisory lock
 * por router serializa asignaciones concurrentes.
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

/** 422 en `red_ipv4_id` si la red no existe o no es del router. */
async function exigirRedDelRouter(trx: TransactionClientContract, redId: number, routerId: number) {
    const red = (await trx.from('network.redes_ipv4').where('id', redId).select('router_id').first()) as {
        router_id: number
    } | null
    if (!red || Number(red.router_id) !== routerId) {
        const mensaje = red ? 'La red IPv4 no es del router del servicio' : 'La red IPv4 no existe'
        throw new ValidacionFallida([{ field: 'red_ipv4_id', message: mensaje, rule: 'red' }], mensaje)
    }
}

/**
 * Asigna una IPv4 al servicio en el router: la pedida (`ip`) o la primera libre (de `redId` si
 * viene; si no, de cualquier red del router). Si el servicio ya tiene esa misma IP vigente en el
 * router (o una de `redId`), la conserva. Lanza 422 si no hay IPs, si la IP no es de una red del
 * router (o de `redId`) o si `redId` no es del router, y 409 si la IP está ocupada por otro servicio.
 */
export async function asignarIpv4(
    trx: TransactionClientContract,
    entrada: { servicioId: number; routerId: number; ip?: string | null; redId?: number | null },
): Promise<Ipv4Asignada> {
    await bloquearRouter(trx, entrada.routerId)
    if (entrada.redId) await exigirRedDelRouter(trx, entrada.redId, entrada.routerId)
    const actual = await ipv4Vigente(trx, entrada.servicioId)

    if (entrada.ip) {
        const { rows } = (await trx.rawQuery(
            `SELECT r.id, masklen(r.cidr) < 31 AND host(network(r.cidr)) = host(?::inet) AS es_red,
                    masklen(r.cidr) < 31 AND host(broadcast(r.cidr)) = host(?::inet) AS es_broadcast,
                    r.gateway IS NOT NULL AND host(r.gateway) = host(?::inet) AS es_gateway,
                    r.rango_inicio IS NOT NULL
                        AND NOT (?::inet BETWEEN r.rango_inicio AND r.rango_fin) AS fuera_de_rango,
                    host(r.rango_inicio) AS rango_inicio, host(r.rango_fin) AS rango_fin
               FROM network.redes_ipv4 r
              WHERE r.router_id = ? AND r.cidr >>= ?::inet`,
            [entrada.ip, entrada.ip, entrada.ip, entrada.ip, entrada.routerId, entrada.ip],
        )) as {
            rows: Array<{
                id: number
                es_red: boolean
                es_broadcast: boolean
                es_gateway: boolean
                fuera_de_rango: boolean
                rango_inicio: string | null
                rango_fin: string | null
            }>
        }
        const red = rows[0]
        if (!red) {
            throw new ValidacionFallida(
                [{ field: 'ipv4', message: 'La IP no pertenece a ninguna red IPv4 del router', rule: 'red' }],
                'La IP no pertenece a ninguna red IPv4 del router',
            )
        }
        if (entrada.redId && red.id !== entrada.redId) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'ipv4',
                        message: 'La IP no pertenece a la red IPv4 elegida',
                        rule: 'red',
                    },
                ],
                'La IP no pertenece a la red IPv4 elegida',
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
        if (red.fuera_de_rango) {
            const mensaje = `La IP está fuera del rango que entrega la red (${red.rango_inicio} – ${red.rango_fin})`
            throw new ValidacionFallida([{ field: 'ipv4', message: mensaje, rule: 'rango' }], mensaje)
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
        if (enRouter && (!entrada.redId || Number(actual.red_id) === entrada.redId)) return actual
        await liberarIpv4(trx, entrada.servicioId)
    }

    const { rows } = (await trx.rawQuery(
        `SELECT r.id AS red_id, host(k.base + g.n) AS ip
           FROM network.redes_ipv4 r
           CROSS JOIN LATERAL ${sqlLimitesRedV4('r')} k
           CROSS JOIN LATERAL generate_series(k.ini, k.fin) AS g(n)
          WHERE r.router_id = ?
            AND (?::bigint = 0 OR r.id = ?::bigint)
            AND (r.gateway IS NULL OR k.base + g.n <> set_masklen(r.gateway, 32))
            AND NOT EXISTS (
                SELECT 1 FROM network.ipv4_asignaciones a
                 WHERE a.fin IS NULL AND a.ip = k.base + g.n
            )
          ORDER BY (r.tipo = 'estatico') DESC, r.id, g.n
          LIMIT 1`,
        [entrada.routerId, entrada.redId ?? 0, entrada.redId ?? 0],
    )) as { rows: Array<{ red_id: number; ip: string }> }
    const libre = rows[0]
    if (!libre && entrada.redId) {
        throw new ValidacionFallida(
            [{ field: 'red_ipv4_id', message: 'La red IPv4 no tiene IPs libres', rule: 'llena' }],
            'La red IPv4 indicada está llena',
        )
    }
    if (!libre) {
        throw new ReglaNegocio('El router no tiene IPv4 libres en sus redes', 'sin_ipv4_libres')
    }
    await trx
        .insertQuery()
        .table('network.ipv4_asignaciones')
        .insert({ servicio_id: entrada.servicioId, red_id: libre.red_id, ip: libre.ip })
    return libre
}
