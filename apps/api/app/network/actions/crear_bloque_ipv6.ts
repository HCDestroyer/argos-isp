import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { prefijoNormalizado } from '#network/ipam_v6'
import { bloqueParaAuditoria, verBloque, type BloqueVista } from '#network/consultas/ipv6'

export interface EntradaCrearBloqueIpv6 {
    router_id: number
    prefijo: string
    nombre?: string | null
    proveedor?: string | null
}

/**
 * Agrega un bloque IPv6 (p. ej. el /40 o /32 de un proveedor) a un router; de él se recortan los
 * pools. Un router puede tener varios bloques, de proveedores distintos; no pueden traslaparse.
 */
export default class CrearBloqueIpv6 extends DomainAction<EntradaCrearBloqueIpv6, BloqueVista> {
    readonly nombre = 'ipv6.crear'

    protected async handle(input: EntradaCrearBloqueIpv6, t: Transaccion) {
        const router = await t.trx.from('network.routers').where('id', input.router_id).first()
        if (!router) throw new NoEncontrado(`El router ${input.router_id} no existe`)
        const prefijo = await prefijoNormalizado(t.trx, input.prefijo)
        await exigirBloqueSinTraslape(t, prefijo)

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.ipv6_bloques')
            .insert({
                router_id: input.router_id,
                prefijo,
                nombre: input.nombre ?? null,
                proveedor: input.proveedor ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('ipv6_bloque', fila!.id)
        const bloque = await verBloque(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'ipv6_bloque', id: bloque.id }, null, bloqueParaAuditoria(bloque))
        return bloque
    }
}

/** 409 `bloque_traslapado` si el prefijo se traslapa con otro bloque (sin contar `excluirId`). */
export async function exigirBloqueSinTraslape(t: Transaccion, prefijo: string, excluirId?: number) {
    const consulta = t.trx
        .from('network.ipv6_bloques')
        .whereRaw('prefijo && ?::cidr', [prefijo])
        .select(t.trx.raw('prefijo::text AS prefijo'))
    if (excluirId) consulta.whereNot('id', excluirId)
    const traslape = (await consulta.first()) as { prefijo: string } | null
    if (traslape) {
        throw new Conflicto(`El bloque se traslapa con ${traslape.prefijo}`, 'bloque_traslapado')
    }
}
