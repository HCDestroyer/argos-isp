import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { oltParaAuditoria, puertoParaAuditoria, verOlt } from '#network/red_acceso/consultas'
import { emitirRedAcceso, exigirVisible } from '#network/red_acceso/reglas'

/**
 * Elimina una OLT y sus puertos PON. Si algún puerto tiene VLAN asignada: 409 `olt_con_vlans`
 * (primero se quitan o se mueven las VLAN). Deja el diff de la OLT y de cada puerto.
 */
export default class EliminarOlt extends DomainAction<{ id: number }, void> {
    readonly nombre = 'olts.eliminar'

    protected async handle(input: { id: number }, t: Transaccion): Promise<void> {
        t.fijarEntidad('olt', input.id)
        const olt = await verOlt(input.id, t.trx)
        exigirVisible(t.ctx, olt.empresa_id)
        t.fijarEmpresa(olt.empresa_id ?? t.ctx.empresaId ?? null)
        const conVlans = olt.puertos.filter((p) => p.vlans > 0)
        if (conVlans.length > 0) {
            throw new Conflicto(
                `Los puertos ${conVlans.map((p) => p.identificador).join(', ')} tienen VLAN asignadas: ` +
                    'quítalas antes de eliminar la OLT',
                'olt_con_vlans',
            )
        }
        for (const puerto of olt.puertos) {
            await t.registrarCambios({ tipo: 'puerto_pon', id: puerto.id }, puertoParaAuditoria(puerto), null)
        }
        await t.trx.from('network.olt_puertos_pon').where('olt_id', input.id).delete()
        await t.trx.from('network.olts').where('id', input.id).delete()
        await t.registrarCambios({ tipo: 'olt', id: input.id }, oltParaAuditoria(olt), null)
        await emitirRedAcceso(t, {
            router_id: null,
            empresa_id: olt.empresa_id,
            entidad: 'olt',
            entidad_id: input.id,
            accion: 'eliminada',
            estado: null,
            campos: [],
        })
    }
}
