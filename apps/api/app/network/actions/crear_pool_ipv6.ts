import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { prefijoNormalizado } from '#network/ipam_v6'
import { verBloque, verPool } from '#network/consultas/ipv6'

export interface EntradaCrearPoolIpv6 {
    bloque_id: number
    prefijo: string
    tipo: 'enlace' | 'delegacion'
    tamano_entrega: 64 | 56 | 48
    nombre_en_router?: string | null
}

/**
 * Recorta un pool dentro de un bloque: `enlace` entrega /64 (Framed-IPv6-Prefix) y `delegacion`
 * /56 o /48 (Delegated-IPv6-Prefix). `nombre_en_router` es el pool de RouterOS para el modo
 * `radius_pool`.
 */
export default class CrearPoolIpv6 extends DomainAction<EntradaCrearPoolIpv6, unknown> {
    readonly nombre = 'ipv6.crear'

    protected async handle(input: EntradaCrearPoolIpv6, t: Transaccion) {
        const bloque = await verBloque(input.bloque_id, t.trx)
        const prefijo = await prefijoNormalizado(t.trx, input.prefijo)
        const errores = []
        if (input.tipo === 'enlace' && input.tamano_entrega !== 64) {
            errores.push({
                field: 'tamano_entrega',
                message: 'Un pool de enlace entrega /64',
                rule: 'enlace',
            })
        }
        const { rows } = (await t.trx.rawQuery(
            `SELECT ?::cidr <<= ?::cidr AS dentro, masklen(?::cidr) AS largo`,
            [prefijo, bloque.prefijo, prefijo],
        )) as { rows: Array<{ dentro: boolean; largo: number }> }
        if (!rows[0]!.dentro) {
            errores.push({
                field: 'prefijo',
                message: `Debe estar dentro del bloque ${bloque.prefijo}`,
                rule: 'bloque',
            })
        }
        if (rows[0]!.largo > input.tamano_entrega) {
            errores.push({
                field: 'prefijo',
                message: 'El pool es más chico que lo que entrega',
                rule: 'tamano',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const traslape = await t.trx
            .from('network.ipv6_pools')
            .whereRaw('prefijo && ?::cidr', [prefijo])
            .first()
        if (traslape) throw new Conflicto('El pool se traslapa con otro existente', 'pool_traslapado')

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.ipv6_pools')
            .insert({
                bloque_id: input.bloque_id,
                prefijo,
                tipo: input.tipo,
                tamano_entrega: input.tamano_entrega,
                nombre_en_router: input.nombre_en_router ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('ipv6_pool', fila!.id)
        const pool = await verPool(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'ipv6_pool', id: pool.id }, null, pool)
        return pool
    }
}
