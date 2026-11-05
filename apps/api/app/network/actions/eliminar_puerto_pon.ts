import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { puertoParaAuditoria, verOlt, verPuertoPon } from '#network/red_acceso/consultas'
import { emitirRedAcceso, exigirVisible } from '#network/red_acceso/reglas'

/** Elimina un puerto PON sin VLAN (409 `puerto_con_vlans`). */
export default class EliminarPuertoPon extends DomainAction<{ id: number }, void> {
    readonly nombre = 'olts.editar'

    protected async handle(input: { id: number }, t: Transaccion): Promise<void> {
        t.fijarEntidad('puerto_pon', input.id)
        const puerto = await verPuertoPon(input.id, t.trx)
        const olt = await verOlt(puerto.olt_id, t.trx)
        exigirVisible(t.ctx, olt.empresa_id)
        t.fijarEmpresa(olt.empresa_id ?? t.ctx.empresaId ?? null)
        if (puerto.vlans > 0) {
            throw new Conflicto(
                `El puerto ${puerto.identificador} tiene ${puerto.vlans} VLAN: quítalas primero`,
                'puerto_con_vlans',
            )
        }
        await t.trx.from('network.olt_puertos_pon').where('id', input.id).delete()
        await t.registrarCambios({ tipo: 'puerto_pon', id: input.id }, puertoParaAuditoria(puerto), null)
        await emitirRedAcceso(t, {
            router_id: null,
            empresa_id: olt.empresa_id,
            entidad: 'puerto_pon',
            entidad_id: input.id,
            accion: 'eliminada',
            estado: null,
            campos: [],
        })
    }
}
