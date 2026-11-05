import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { servidorParaAuditoria, verServidorPppoe } from '#network/red_acceso/consultas'
import { emitirRedAcceso, exigirVisible } from '#network/red_acceso/reglas'

/**
 * Elimina un servidor PPPoE sin servicios vigentes (409 `servidor_con_servicios`). Los retirados
 * que lo tenían quedan sin servidor (historial). `administrado`: A2 lo borra del router con su
 * perfil; `adoptado`: solo la fila.
 */
export default class EliminarServidorPppoe extends DomainAction<{ id: number }, void> {
    readonly nombre = 'servidores_pppoe.eliminar'

    protected async handle(input: { id: number }, t: Transaccion): Promise<void> {
        t.fijarEntidad('servidor_pppoe', input.id)
        const servidor = await verServidorPppoe(input.id, t.trx)
        exigirVisible(t.ctx, servidor.empresa_id)
        t.fijarEmpresa(servidor.empresa_id ?? t.ctx.empresaId ?? null)
        if (servidor.servicios > 0) {
            throw new Conflicto(
                `El servidor PPPoE «${servidor.nombre}» tiene ${servidor.servicios} servicios: pásalos a otro servidor primero`,
                'servidor_con_servicios',
            )
        }
        const retirados = (await t.trx
            .from('core.servicios')
            .where('servidor_pppoe_id', input.id)
            .select('id')) as Array<{ id: number }>
        for (const { id } of retirados) {
            await t.trx.from('core.servicios').where('id', id).update({ servidor_pppoe_id: null })
            await t.registrarCambios(
                { tipo: 'servicio', id: Number(id) },
                { servidor_pppoe_id: input.id },
                { servidor_pppoe_id: null },
            )
        }
        await t.trx.from('network.servidores_pppoe').where('id', input.id).delete()
        await t.registrarCambios(
            { tipo: 'servidor_pppoe', id: input.id },
            servidorParaAuditoria(servidor),
            null,
        )
        await emitirRedAcceso(t, {
            router_id: servidor.router_id,
            empresa_id: servidor.empresa_id,
            entidad: 'servidor_pppoe',
            entidad_id: input.id,
            accion: 'eliminada',
            estado: servidor.estado,
            campos: [],
        })
    }
}
