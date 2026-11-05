import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { verVlan, vlanParaAuditoria } from '#network/red_acceso/consultas'
import { emitirRedAcceso, exigirVisible } from '#network/red_acceso/reglas'

/**
 * Elimina una VLAN sin servidor PPPoE (409 `vlan_con_servidor`). Si era `administrado`, A2 la
 * borra del router (solo la que tiene `comment = argosisp:vlan:<id>`); si era `adoptado`, solo se
 * borra la fila: el router no se toca.
 */
export default class EliminarVlan extends DomainAction<{ id: number }, void> {
    readonly nombre = 'vlans.eliminar'

    protected async handle(input: { id: number }, t: Transaccion): Promise<void> {
        t.fijarEntidad('vlan', input.id)
        const vlan = await verVlan(input.id, t.trx)
        exigirVisible(t.ctx, vlan.empresa_id)
        t.fijarEmpresa(vlan.empresa_id ?? t.ctx.empresaId ?? null)
        const servidor = (await t.trx
            .from('network.servidores_pppoe')
            .where('vlan_id', input.id)
            .select('nombre')
            .first()) as { nombre: string } | null
        if (servidor) {
            throw new Conflicto(
                `La VLAN la usa el servidor PPPoE «${servidor.nombre}»: elimínalo o cámbialo primero`,
                'vlan_con_servidor',
            )
        }
        await t.trx.from('network.vlans').where('id', input.id).delete()
        await t.registrarCambios({ tipo: 'vlan', id: input.id }, vlanParaAuditoria(vlan), null)
        await emitirRedAcceso(t, {
            router_id: vlan.router_id,
            empresa_id: vlan.empresa_id,
            entidad: 'vlan',
            entidad_id: input.id,
            accion: 'eliminada',
            estado: vlan.estado,
            campos: [],
        })
    }
}
