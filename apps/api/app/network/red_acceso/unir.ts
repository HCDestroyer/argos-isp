import type { Transaccion } from '#shared/domain_action'
import {
    servidorParaAuditoria,
    verServidorPppoe,
    verVlan,
    vlanParaAuditoria,
} from '#network/red_acceso/consultas'
import { emitirRedAcceso } from '#network/red_acceso/reglas'

/**
 * `routers.unir` (`contratos/routers.md`): las VLAN y servidores PPPoE del router absorbido pasan al
 * que queda (es el mismo MikroTik). Si el que queda ya tiene la misma VLAN (interfaz padre +
 * vlan_id, o el nombre) o un servidor en la misma interfaz, se usa la suya: los servicios pasan a
 * ese servidor y la fila duplicada se borra. Se llama después de mover las redes y antes de los
 * servicios. Cada fila deja su diff y su `red_acceso.cambiada`.
 */
export async function moverRedAcceso(
    t: Transaccion,
    absorbidoId: number,
    quedaId: number,
    avisos: string[],
): Promise<void> {
    const vlanMapa = new Map<number, number>()
    const vlans = (await t.trx
        .from('network.vlans')
        .where('router_id', absorbidoId)
        .orderBy('id')
        .select('id', 'interfaz_padre', 'vlan_id', 'nombre')) as Array<{
        id: number
        interfaz_padre: string
        vlan_id: number
        nombre: string
    }>
    for (const vlan of vlans) {
        const igual = (await t.trx
            .from('network.vlans')
            .where('router_id', quedaId)
            .where((q) =>
                q
                    .where((w) =>
                        w.where('interfaz_padre', vlan.interfaz_padre).where('vlan_id', vlan.vlan_id),
                    )
                    .orWhereRaw('lower(nombre) = lower(?)', [vlan.nombre]),
            )
            .select('id')
            .first()) as { id: number } | null
        if (igual) {
            vlanMapa.set(Number(vlan.id), Number(igual.id))
            continue
        }
        const antes = await verVlan(Number(vlan.id), t.trx)
        await t.trx
            .from('network.vlans')
            .where('id', vlan.id)
            .update({
                router_id: quedaId,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verVlan(Number(vlan.id), t.trx)
        await t.registrarCambios(
            { tipo: 'vlan', id: despues.id },
            vlanParaAuditoria(antes),
            vlanParaAuditoria(despues),
        )
        await emitirRedAcceso(t, {
            router_id: quedaId,
            empresa_id: despues.empresa_id,
            entidad: 'vlan',
            entidad_id: despues.id,
            accion: 'editada',
            estado: despues.estado,
            campos: ['router_id'],
        })
    }

    const servidores = (await t.trx
        .from('network.servidores_pppoe')
        .where('router_id', absorbidoId)
        .orderBy('id')
        .select('id', 'interfaz', 'nombre', 'vlan_id')) as Array<{
        id: number
        interfaz: string
        nombre: string
        vlan_id: number | null
    }>
    for (const servidor of servidores) {
        const antes = await verServidorPppoe(Number(servidor.id), t.trx)
        const igual = (await t.trx
            .from('network.servidores_pppoe')
            .where('router_id', quedaId)
            .where((q) =>
                q
                    .whereRaw('lower(interfaz) = lower(?)', [servidor.interfaz])
                    .orWhereRaw('lower(nombre) = lower(?)', [servidor.nombre]),
            )
            .select('id', 'nombre')
            .first()) as { id: number; nombre: string } | null
        if (igual) {
            const servicios = (await t.trx
                .from('core.servicios')
                .where('servidor_pppoe_id', servidor.id)
                .select('id')) as Array<{ id: number }>
            for (const { id } of servicios) {
                await t.trx.from('core.servicios').where('id', id).update({ servidor_pppoe_id: igual.id })
                await t.registrarCambios(
                    { tipo: 'servicio', id: Number(id) },
                    { servidor_pppoe_id: Number(servidor.id) },
                    { servidor_pppoe_id: Number(igual.id) },
                )
            }
            await t.trx.from('network.servidores_pppoe').where('id', servidor.id).delete()
            await t.registrarCambios(
                { tipo: 'servidor_pppoe', id: antes.id },
                servidorParaAuditoria(antes),
                null,
            )
            await emitirRedAcceso(t, {
                router_id: absorbidoId,
                empresa_id: antes.empresa_id,
                entidad: 'servidor_pppoe',
                entidad_id: antes.id,
                accion: 'eliminada',
                estado: antes.estado,
                campos: [],
            })
            avisos.push(
                `El servidor PPPoE «${antes.nombre}» ya estaba en el router que queda como «${igual.nombre}»: sus servicios pasan a ese`,
            )
            continue
        }
        const vlanNueva = servidor.vlan_id !== null ? vlanMapa.get(Number(servidor.vlan_id)) : undefined
        await t.trx
            .from('network.servidores_pppoe')
            .where('id', servidor.id)
            .update({
                router_id: quedaId,
                ...(vlanNueva ? { vlan_id: vlanNueva } : {}),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verServidorPppoe(Number(servidor.id), t.trx)
        await t.registrarCambios(
            { tipo: 'servidor_pppoe', id: despues.id },
            servidorParaAuditoria(antes),
            servidorParaAuditoria(despues),
        )
        await emitirRedAcceso(t, {
            router_id: quedaId,
            empresa_id: despues.empresa_id,
            entidad: 'servidor_pppoe',
            entidad_id: despues.id,
            accion: 'editada',
            estado: despues.estado,
            campos: vlanNueva ? ['router_id', 'vlan_id'] : ['router_id'],
        })
    }

    for (const [absorbida] of vlanMapa) {
        const antes = await verVlan(absorbida, t.trx)
        await t.trx.from('network.vlans').where('id', absorbida).delete()
        await t.registrarCambios({ tipo: 'vlan', id: absorbida }, vlanParaAuditoria(antes), null)
        await emitirRedAcceso(t, {
            router_id: absorbidoId,
            empresa_id: antes.empresa_id,
            entidad: 'vlan',
            entidad_id: absorbida,
            accion: 'eliminada',
            estado: antes.estado,
            campos: [],
        })
    }
}
