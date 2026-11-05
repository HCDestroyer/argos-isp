import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import {
    servidorParaAuditoria,
    verServidorPppoe,
    type ServidorPppoeVista,
} from '#network/red_acceso/consultas'
import {
    camposCambiados,
    emitirRedAcceso,
    exigirCamposArgos,
    exigirEmpresa,
    exigirVisible,
} from '#network/red_acceso/reglas'
import {
    columnasServidor,
    validarServidorPppoe,
    type DatosServidorPppoe,
} from '#network/actions/crear_servidor_pppoe'

export interface EntradaEditarServidorPppoe extends DatosServidorPppoe {
    id: number
    version: number
}

/** Campos de Argos que se editan también en un servidor adoptado. */
export const CAMPOS_ARGOS_SERVIDOR = [
    'nombre',
    'descripcion',
    'empresa_id',
    'red_ipv4_id',
    'ipv6_pool_enlace_id',
    'ipv6_pool_delegacion_id',
    'activo',
] as const

/**
 * Edita un servidor PPPoE (409 por `version`). En uno `adoptado` solo los campos de Argos (422
 * `adoptado_solo_lectura`). Si cambia la red, cambia el `local-address` (`campos` del evento lleva
 * `local_address`) y se reescribe `aaa:user:*` de los servicios del router.
 */
export default class EditarServidorPppoe extends DomainAction<
    EntradaEditarServidorPppoe,
    ServidorPppoeVista
> {
    readonly nombre = 'servidores_pppoe.editar'

    protected async handle(input: EntradaEditarServidorPppoe, t: Transaccion): Promise<ServidorPppoeVista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('servidor_pppoe', id)
        const antes = await verServidorPppoe(id, t.trx)
        exigirVisible(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id ?? t.ctx.empresaId ?? null)
        exigirCamposArgos(antes.estado, cambios, CAMPOS_ARGOS_SERVIDOR)
        if (cambios.empresa_id !== undefined) exigirEmpresa(t.ctx, cambios.empresa_id)

        const vlanId = cambios.vlan_id !== undefined ? cambios.vlan_id : antes.vlan_id
        const interfaz = await validarServidorPppoe(
            t.trx,
            antes.router_id,
            antes.estado,
            {
                nombre: cambios.nombre ?? antes.nombre,
                vlan_id: vlanId,
                // con VLAN la interfaz es la suya; sin VLAN, la pedida o la que tenía
                interfaz: vlanId ? cambios.interfaz : (cambios.interfaz ?? antes.interfaz),
                red_ipv4_id: cambios.red_ipv4_id !== undefined ? cambios.red_ipv4_id : antes.red_ipv4_id,
                ipv6_pool_enlace_id:
                    cambios.ipv6_pool_enlace_id !== undefined
                        ? cambios.ipv6_pool_enlace_id
                        : antes.ipv6_pool_enlace_id,
                ipv6_pool_delegacion_id:
                    cambios.ipv6_pool_delegacion_id !== undefined
                        ? cambios.ipv6_pool_delegacion_id
                        : antes.ipv6_pool_delegacion_id,
                max_mru: cambios.max_mru ?? antes.max_mru,
                mrru: cambios.mrru !== undefined ? cambios.mrru : antes.mrru,
            },
            id,
        )
        const columnas = columnasServidor(cambios)
        if (antes.estado === 'administrado') columnas.interfaz = interfaz
        await actualizarConVersion(t.trx, 'network.servidores_pppoe', id, version, columnas)
        const despues = await verServidorPppoe(id, t.trx)
        await t.registrarCambios(
            { tipo: 'servidor_pppoe', id },
            servidorParaAuditoria(antes),
            servidorParaAuditoria(despues),
        )
        const campos = camposCambiados(servidorParaAuditoria(antes), servidorParaAuditoria(despues))
        if (despues.local_address !== antes.local_address) campos.push('local_address')
        if (campos.length > 0) {
            await emitirRedAcceso(t, {
                router_id: despues.router_id,
                empresa_id: despues.empresa_id,
                entidad: 'servidor_pppoe',
                entidad_id: id,
                accion: 'editada',
                estado: despues.estado,
                campos,
            })
        }
        if (campos.includes('local_address')) refrescarAaaAlConfirmar(t, { routerId: despues.router_id })
        return despues
    }
}
