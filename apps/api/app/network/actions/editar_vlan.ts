import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { verVlan, vlanParaAuditoria, type VlanVista } from '#network/red_acceso/consultas'
import {
    camposCambiados,
    emitirRedAcceso,
    exigirCamposArgos,
    exigirEmpresa,
    exigirVisible,
} from '#network/red_acceso/reglas'
import { exigirCupoPuerto, exigirVlanUnica } from '#network/actions/crear_vlan'

export interface EntradaEditarVlan {
    id: number
    version: number
    interfaz_padre?: string
    vlan_id?: number
    nombre?: string
    puerto_pon_id?: number | null
    mtu?: number | null
    empresa_id?: number | null
    descripcion?: string | null
}

/** Campos de Argos que se editan también en una VLAN adoptada. */
export const CAMPOS_ARGOS_VLAN = ['puerto_pon_id', 'empresa_id', 'descripcion'] as const

/**
 * Edita una VLAN (409 por `version`). Si es `adoptada`, solo los campos de Argos (422
 * `adoptado_solo_lectura`). Renombrar la interfaz de una VLAN con servidor PPPoE renombra también
 * la `interfaz` del servidor (mismo cambio en RouterOS).
 */
export default class EditarVlan extends DomainAction<EntradaEditarVlan, VlanVista> {
    readonly nombre = 'vlans.editar'

    protected async handle(input: EntradaEditarVlan, t: Transaccion): Promise<VlanVista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('vlan', id)
        const antes = await verVlan(id, t.trx)
        exigirVisible(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id ?? t.ctx.empresaId ?? null)
        exigirCamposArgos(antes.estado, cambios, CAMPOS_ARGOS_VLAN)
        if (cambios.empresa_id !== undefined) exigirEmpresa(t.ctx, cambios.empresa_id)
        const datos = {
            router_id: antes.router_id,
            interfaz_padre: cambios.interfaz_padre ?? antes.interfaz_padre,
            vlan_id: cambios.vlan_id ?? antes.vlan_id,
            nombre: cambios.nombre ?? antes.nombre,
        }
        await exigirVlanUnica(t.trx, datos, id)
        if (cambios.puerto_pon_id && cambios.puerto_pon_id !== antes.puerto_pon_id) {
            await exigirCupoPuerto(t.trx, cambios.puerto_pon_id, id)
        }
        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.vlans', id, version, columnas)
        const servidor = (await t.trx
            .from('network.servidores_pppoe')
            .where('vlan_id', id)
            .select('id', 'interfaz')
            .first()) as { id: number; interfaz: string } | null
        if (servidor && datos.nombre !== antes.nombre) {
            // un servidor por VLAN: su interfaz es el nombre de la VLAN (RouterOS la sigue al renombrar)
            await t.trx
                .from('network.servidores_pppoe')
                .where('id', servidor.id)
                .update({
                    interfaz: datos.nombre,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'servidor_pppoe', id: Number(servidor.id) },
                { interfaz: servidor.interfaz },
                { interfaz: datos.nombre },
            )
        }
        const despues = await verVlan(id, t.trx)
        await t.registrarCambios({ tipo: 'vlan', id }, vlanParaAuditoria(antes), vlanParaAuditoria(despues))
        const campos = camposCambiados(vlanParaAuditoria(antes), vlanParaAuditoria(despues))
        if (campos.length > 0) {
            await emitirRedAcceso(t, {
                router_id: despues.router_id,
                empresa_id: despues.empresa_id,
                entidad: 'vlan',
                entidad_id: id,
                accion: 'editada',
                estado: despues.estado,
                campos,
            })
        }
        return despues
    }
}
