import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { prefijoNormalizado } from '#network/ipam_v6'
import { poolParaAuditoria, verBloque, verPool, type PoolVista } from '#network/consultas/ipv6'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export interface EntradaCrearPoolIpv6 {
    bloque_id: number
    prefijo: string
    tipo: 'enlace' | 'delegacion'
    tamano_entrega: 64 | 56 | 48
    nombre?: string | null
    nombre_en_router?: string | null
}

/**
 * Recorta un pool dentro de un bloque: `enlace` entrega /64 (Framed-IPv6-Prefix) y `delegacion`
 * /56 o /48 (Delegated-IPv6-Prefix). `nombre_en_router` es el pool de RouterOS para el modo
 * `radius_pool`. Un bloque admite varios pools de cada tipo; no pueden traslaparse.
 */
export default class CrearPoolIpv6 extends DomainAction<EntradaCrearPoolIpv6, PoolVista> {
    readonly nombre = 'ipv6.crear'

    protected async handle(input: EntradaCrearPoolIpv6, t: Transaccion) {
        const prefijo = await validarPoolIpv6(t.trx, input)
        await exigirPoolSinTraslape(t.trx, prefijo)

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.ipv6_pools')
            .insert({
                bloque_id: input.bloque_id,
                prefijo,
                tipo: input.tipo,
                tamano_entrega: input.tamano_entrega,
                nombre: input.nombre ?? null,
                nombre_en_router: input.nombre_en_router ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('ipv6_pool', fila!.id)
        const pool = await verPool(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'ipv6_pool', id: pool.id }, null, poolParaAuditoria(pool))
        return pool
    }
}

/**
 * 422 por campo si el pool no viene normalizado, si no cabe en su bloque, si es más chico que lo
 * que entrega o si un pool de enlace no entrega /64. Devuelve el prefijo normalizado.
 */
export async function validarPoolIpv6(
    trx: TransactionClientContract,
    datos: { bloque_id: number; prefijo: string; tipo: 'enlace' | 'delegacion'; tamano_entrega: number },
): Promise<string> {
    const bloque = await verBloque(datos.bloque_id, trx)
    const prefijo = await prefijoNormalizado(trx, datos.prefijo)
    const errores: ErrorCampo[] = []
    if (datos.tipo === 'enlace' && datos.tamano_entrega !== 64) {
        errores.push({
            field: 'tamano_entrega',
            message: 'Un pool de enlace entrega /64: es la red de la conexión PPPoE de cada cliente',
            rule: 'enlace',
        })
    }
    const { rows } = (await trx.rawQuery(`SELECT ?::cidr <<= ?::cidr AS dentro, masklen(?::cidr) AS largo`, [
        prefijo,
        bloque.prefijo,
        prefijo,
    ])) as { rows: Array<{ dentro: boolean; largo: number }> }
    if (!rows[0]!.dentro) {
        errores.push({
            field: 'prefijo',
            message: `Debe estar dentro del bloque ${bloque.prefijo}`,
            rule: 'bloque',
        })
    }
    if (rows[0]!.largo > datos.tamano_entrega) {
        errores.push({
            field: 'prefijo',
            message: `El pool /${rows[0]!.largo} es más chico que el /${datos.tamano_entrega} que entrega a cada cliente`,
            rule: 'tamano',
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, errores[0]!.message)
    return prefijo
}

/** 409 `pool_traslapado` si el prefijo se traslapa con otro pool (sin contar `excluirId`). */
export async function exigirPoolSinTraslape(
    trx: TransactionClientContract,
    prefijo: string,
    excluirId?: number,
) {
    const consulta = trx
        .from('network.ipv6_pools')
        .whereRaw('prefijo && ?::cidr', [prefijo])
        .select(trx.raw('prefijo::text AS prefijo'))
    if (excluirId) consulta.whereNot('id', excluirId)
    const traslape = (await consulta.first()) as { prefijo: string } | null
    if (traslape) throw new Conflicto(`El pool se traslapa con ${traslape.prefijo}`, 'pool_traslapado')
}
