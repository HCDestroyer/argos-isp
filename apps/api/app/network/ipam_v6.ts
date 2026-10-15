import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { capacidad, indiceEnPool, separarPrefijo, subprefijo } from '#network/ipv6'

/**
 * IPAM IPv6: prefijos de enlace (/64) y delegados (/56 o /48 según el plan) por servicio, tomados
 * de los pools (`network.ipv6_pools`) de los bloques del router. Historial en
 * `network.ipv6_asignaciones` (vigente = `fin IS NULL`; un prefijo vigente por servicio y tipo).
 *
 * - Estable: si el servicio ya tiene un prefijo vigente del tipo y tamaño pedidos en un pool del
 *   router, se conserva. Si lo perdió (cambio de router o de plan) y su prefijo anterior en ese
 *   pool sigue libre, lo recupera.
 * - Único: índice único de prefijo vigente + advisory lock por pool; además no se entrega un
 *   prefijo que se traslape con otro vigente (p. ej. un estático manual).
 */

export type TipoPrefijo = 'enlace' | 'delegacion'

/** Valida que el prefijo venga normalizado (sin bits de host) y lo devuelve como texto de Postgres. */
export async function prefijoNormalizado(trx: TransactionClientContract, prefijo: string, campo = 'prefijo') {
    const { rows } = (await trx.rawQuery(`SELECT network(?::inet)::text AS red, ?::inet::text AS texto`, [
        prefijo,
        prefijo,
    ])) as { rows: Array<{ red: string; texto: string }> }
    const { red, texto } = rows[0]!
    if (red !== texto) {
        throw new ValidacionFallida([{ field: campo, message: `Escríbelo como ${red}`, rule: 'cidr' }])
    }
    return red
}

interface PoolFila {
    id: number
    prefijo: string
}

export async function prefijoVigente(
    trx: TransactionClientContract,
    servicioId: number,
    tipo: TipoPrefijo,
): Promise<{ id: number; pool_id: number | null; prefijo: string } | null> {
    return (await trx
        .from('network.ipv6_asignaciones')
        .where({ servicio_id: servicioId, tipo })
        .whereNull('fin')
        .select('id', 'pool_id', trx.raw('prefijo::text AS prefijo'))
        .first()) as { id: number; pool_id: number | null; prefijo: string } | null
}

/** Cierra los prefijos vigentes del servicio (de un tipo o de todos). Devuelve los liberados. */
export async function liberarPrefijos(
    trx: TransactionClientContract,
    servicioId: number,
    tipo?: TipoPrefijo,
): Promise<string[]> {
    const consulta = trx.from('network.ipv6_asignaciones').where('servicio_id', servicioId).whereNull('fin')
    if (tipo) consulta.where('tipo', tipo)
    const filas = (await consulta.update({ fin: trx.knexRawQuery('now()') } as Record<string, unknown>, [
        'prefijo',
    ])) as Array<{ prefijo: string }>
    return filas.map((f) => f.prefijo)
}

async function insertar(
    trx: TransactionClientContract,
    fila: { servicioId: number; poolId: number | null; prefijo: string; tipo: TipoPrefijo },
): Promise<string> {
    const [nueva] = (await trx
        .insertQuery()
        .table('network.ipv6_asignaciones')
        .insert({
            servicio_id: fila.servicioId,
            pool_id: fila.poolId,
            prefijo: fila.prefijo,
            tipo: fila.tipo,
        })
        .returning('id')) as Array<{ id: number }>
    const guardada = (await trx
        .from('network.ipv6_asignaciones')
        .where('id', nueva!.id)
        .select(trx.raw('prefijo::text AS prefijo'))
        .firstOrFail()) as { prefijo: string }
    return guardada.prefijo
}

async function libre(trx: TransactionClientContract, prefijo: string): Promise<boolean> {
    const ocupado = await trx
        .from('network.ipv6_asignaciones')
        .whereNull('fin')
        .whereRaw('prefijo && ?::cidr', [prefijo])
        .first()
    return !ocupado
}

/** Primer índice libre del pool, considerando cualquier prefijo vigente que se traslape. */
async function primerIndiceLibre(trx: TransactionClientContract, pool: PoolFila, tamano: number) {
    const vigentes = (await trx
        .from('network.ipv6_asignaciones')
        .whereNull('fin')
        .whereRaw('prefijo && ?::cidr', [pool.prefijo])
        .select(trx.raw('prefijo::text AS prefijo'))) as Array<{ prefijo: string }>

    const { largo: largoPool } = separarPrefijo(pool.prefijo)
    const rangos: Array<[bigint, bigint]> = []
    for (const { prefijo } of vigentes) {
        const { largo } = separarPrefijo(prefijo)
        if (largo < largoPool) return null // un prefijo mayor cubre todo el pool
        const inicio = indiceEnPool(pool.prefijo, prefijo, tamano)
        const cuenta = largo >= tamano ? 1n : 1n << BigInt(tamano - largo)
        rangos.push([inicio, inicio + cuenta - 1n])
    }
    rangos.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    let candidato = 0n
    for (const [inicio, fin] of rangos) {
        if (inicio > candidato) break
        if (fin >= candidato) candidato = fin + 1n
    }
    return candidato < capacidad(pool.prefijo, tamano) ? candidato : null
}

/**
 * Reserva (o conserva) el prefijo `tipo` de tamaño `tamano` para el servicio en los pools del
 * router. 422 `sin_pool_ipv6` si el router no tiene pool de ese tipo y tamaño; 422
 * `sin_prefijos_libres` si están llenos.
 */
export async function reservarPrefijo(
    trx: TransactionClientContract,
    entrada: { servicioId: number; routerId: number; tipo: TipoPrefijo; tamano: number },
): Promise<string> {
    const pools = (await trx
        .from('network.ipv6_pools as p')
        .join('network.ipv6_bloques as b', 'b.id', 'p.bloque_id')
        .where('b.router_id', entrada.routerId)
        .where('p.tipo', entrada.tipo)
        .where('p.tamano_entrega', entrada.tamano)
        .orderBy('p.id')
        .select('p.id', trx.raw('p.prefijo::text AS prefijo'))) as PoolFila[]

    const actual = await prefijoVigente(trx, entrada.servicioId, entrada.tipo)
    if (actual && actual.pool_id !== null && pools.some((p) => p.id === actual.pool_id)) {
        return actual.prefijo
    }
    if (actual) await liberarPrefijos(trx, entrada.servicioId, entrada.tipo)

    if (pools.length === 0) {
        const nombre = entrada.tipo === 'enlace' ? 'de enlace' : 'de delegación'
        throw new ReglaNegocio(`El router no tiene pool IPv6 ${nombre} /${entrada.tamano}`, 'sin_pool_ipv6')
    }

    for (const pool of pools) {
        await trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v6:pool:' || ?::text))`, [pool.id])

        const previo = (await trx
            .from('network.ipv6_asignaciones')
            .where({ servicio_id: entrada.servicioId, tipo: entrada.tipo, pool_id: pool.id })
            .whereNotNull('fin')
            .whereRaw('masklen(prefijo) = ?', [entrada.tamano])
            .orderBy('fin', 'desc')
            .select(trx.raw('prefijo::text AS prefijo'))
            .first()) as { prefijo: string } | null
        if (previo && (await libre(trx, previo.prefijo))) {
            return insertar(trx, { ...entrada, poolId: pool.id, prefijo: previo.prefijo })
        }

        const indice = await primerIndiceLibre(trx, pool, entrada.tamano)
        if (indice !== null) {
            const prefijo = subprefijo(pool.prefijo, entrada.tamano, indice)
            return insertar(trx, { ...entrada, poolId: pool.id, prefijo })
        }
    }
    throw new ReglaNegocio('Los pools IPv6 del router no tienen prefijos libres', 'sin_prefijos_libres')
}

/**
 * Modo `estatico`: prefijo delegado puesto a mano (ruteado por API de RouterOS, A6). Debe venir
 * normalizado y no traslaparse con otro vigente (409).
 */
export async function asignarPrefijoEstatico(
    trx: TransactionClientContract,
    entrada: { servicioId: number; prefijo: string },
): Promise<string> {
    const red = await prefijoNormalizado(trx, entrada.prefijo, 'prefijo_delegado_v6')

    const actual = await prefijoVigente(trx, entrada.servicioId, 'delegacion')
    if (actual?.prefijo === red) return actual.prefijo
    if (actual) await liberarPrefijos(trx, entrada.servicioId, 'delegacion')

    const ocupado = (await trx
        .from('network.ipv6_asignaciones')
        .whereNull('fin')
        .whereRaw('prefijo && ?::cidr', [red])
        .select('servicio_id')
        .first()) as { servicio_id: number } | null
    if (ocupado) {
        throw new Conflicto(
            `El prefijo se traslapa con uno vigente del servicio ${ocupado.servicio_id}`,
            'prefijo_ocupado',
        )
    }
    const pool = (await trx
        .from('network.ipv6_pools')
        .whereRaw('prefijo >>= ?::cidr', [red])
        .select('id')
        .first()) as { id: number } | null
    return insertar(trx, {
        servicioId: entrada.servicioId,
        poolId: pool?.id ?? null,
        prefijo: red,
        tipo: 'delegacion',
    })
}
