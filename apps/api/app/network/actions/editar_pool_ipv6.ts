import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { poolParaAuditoria, verPool, type PoolVista } from '#network/consultas/ipv6'
import { exigirPoolSinTraslape, validarPoolIpv6 } from '#network/actions/crear_pool_ipv6'
import { MAXIMO_LISTA } from '#network/reglas_pools'

export interface EntradaEditarPoolIpv6 {
    id: number
    version: number
    prefijo?: string
    tipo?: 'enlace' | 'delegacion'
    tamano_entrega?: 64 | 56 | 48
    nombre?: string | null
    nombre_en_router?: string | null
}

interface PrefijoAsignado {
    prefijo: string
    servicio_id: number
    user_ppp: string | null
}

/**
 * Edita un pool IPv6 (`contratos/pools.md` §1) con control optimista por `version` (409).
 *
 * - Achicar o mover el prefijo dejando fuera prefijos asignados: 422 `prefijos_asignados_fuera`
 *   con la lista. El pool debe seguir dentro de su bloque y sin traslaparse con otro (409).
 * - `tipo` y `tamano_entrega` solo cambian si el pool no tiene prefijos asignados (422
 *   `pool_con_asignaciones` con la lista): cambiarlos dejaría a esos servicios con un prefijo que
 *   el pool ya no entrega.
 * - Ningún prefijo de servicio cambia: solo auditoría y diff.
 */
export default class EditarPoolIpv6 extends DomainAction<EntradaEditarPoolIpv6, PoolVista> {
    readonly nombre = 'ipv6.editar'

    protected async handle(input: EntradaEditarPoolIpv6, t: Transaccion): Promise<PoolVista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('ipv6_pool', id)
        const fila = await t.trx.from('network.ipv6_pools').where('id', id).forUpdate().first()
        if (!fila) throw new NoEncontrado(`El pool IPv6 ${id} no existe`)
        // serializa con las reservas del pool (`ipam_v6`)
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v6:pool:' || ?::text))`, [id])
        const antes = await verPool(id, t.trx)

        const tipo = cambios.tipo ?? antes.tipo
        const tamano = cambios.tamano_entrega ?? antes.tamano_entrega
        const prefijo = await validarPoolIpv6(t.trx, {
            bloque_id: antes.bloque_id,
            prefijo: cambios.prefijo ?? antes.prefijo,
            tipo,
            tamano_entrega: tamano,
        })
        if (cambios.prefijo !== undefined) cambios.prefijo = prefijo

        const asignados = (await t.trx
            .from('network.ipv6_asignaciones as a')
            .join('core.servicios as s', 's.id', 'a.servicio_id')
            .where('a.pool_id', id)
            .whereNull('a.fin')
            .orderBy('a.prefijo')
            .select(
                t.trx.raw('a.prefijo::text AS prefijo'),
                'a.servicio_id',
                's.user_ppp',
            )) as PrefijoAsignado[]
        const describir = (a: PrefijoAsignado) =>
            `${a.prefijo} (servicio ${a.servicio_id}${a.user_ppp ? `, ${a.user_ppp}` : ''})`

        if ((tipo !== antes.tipo || tamano !== antes.tamano_entrega) && asignados.length > 0) {
            throw new ReglaNegocio(
                `El pool tiene ${asignados.length} prefijos asignados: el tipo y el tamaño de entrega solo cambian en un pool vacío`,
                'pool_con_asignaciones',
                asignados.slice(0, MAXIMO_LISTA).map((a) => ({
                    field: tipo !== antes.tipo ? 'tipo' : 'tamano_entrega',
                    message: describir(a),
                    rule: 'asignado',
                })),
            )
        }
        if (prefijo !== antes.prefijo) {
            await exigirPoolSinTraslape(t.trx, prefijo, id)
            const { rows } = (await t.trx.rawQuery(
                `SELECT a.prefijo::text AS prefijo, a.servicio_id, s.user_ppp
                   FROM network.ipv6_asignaciones a
                   JOIN core.servicios s ON s.id = a.servicio_id
                  WHERE a.pool_id = ? AND a.fin IS NULL AND NOT (a.prefijo <<= ?::cidr)
                  ORDER BY a.prefijo`,
                [id, prefijo],
            )) as { rows: PrefijoAsignado[] }
            if (rows.length > 0) {
                throw new ReglaNegocio(
                    `${rows.length} prefijos asignados quedarían fuera del pool ${prefijo}: libéralos o muévelos antes`,
                    'prefijos_asignados_fuera',
                    rows.slice(0, MAXIMO_LISTA).map((a) => ({
                        field: 'prefijo',
                        message: `${describir(a)} quedaría fuera del pool`,
                        rule: 'asignado',
                    })),
                )
            }
        }

        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.ipv6_pools', id, version, columnas)
        const despues = await verPool(id, t.trx)
        await t.registrarCambios(
            { tipo: 'ipv6_pool', id },
            poolParaAuditoria(antes),
            poolParaAuditoria(despues),
        )
        return despues
    }
}
