import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { prefijoNormalizado } from '#network/ipam_v6'
import { verBloque } from '#network/consultas/ipv6'

export interface EntradaCrearBloqueIpv6 {
    router_id: number
    prefijo: string
}

/** Agrega un bloque IPv6 (p. ej. /40) a un router; de él se recortan los pools. */
export default class CrearBloqueIpv6 extends DomainAction<EntradaCrearBloqueIpv6, unknown> {
    readonly nombre = 'ipv6.crear'

    protected async handle(input: EntradaCrearBloqueIpv6, t: Transaccion) {
        const router = await t.trx.from('network.routers').where('id', input.router_id).first()
        if (!router) throw new NoEncontrado(`El router ${input.router_id} no existe`)
        const prefijo = await prefijoNormalizado(t.trx, input.prefijo)
        const traslape = await t.trx
            .from('network.ipv6_bloques')
            .whereRaw('prefijo && ?::cidr', [prefijo])
            .first()
        if (traslape) throw new Conflicto('El bloque se traslapa con otro existente', 'bloque_traslapado')

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.ipv6_bloques')
            .insert({ router_id: input.router_id, prefijo })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('ipv6_bloque', fila!.id)
        const bloque = await verBloque(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'ipv6_bloque', id: bloque.id }, null, bloque)
        return bloque
    }
}
