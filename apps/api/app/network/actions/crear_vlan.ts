import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { verPuertoPon, verVlan, vlanParaAuditoria, type VlanVista } from '#network/red_acceso/consultas'
import {
    MAX_VLANS_POR_PUERTO,
    campo,
    emitirRedAcceso,
    exigirEmpresa,
    exigirRouter,
    exigirUnico,
} from '#network/red_acceso/reglas'

export interface EntradaCrearVlan {
    router_id: number
    interfaz_padre: string
    vlan_id: number
    nombre?: string
    puerto_pon_id?: number | null
    mtu?: number | null
    empresa_id?: number | null
    descripcion?: string | null
}

/**
 * Unicidad de una VLAN en su router: (interfaz padre, vlan_id) → 409 `vlan_duplicada`; nombre de
 * la interfaz → 409 `nombre_interfaz_duplicado` (`contratos/red-acceso.md` §1).
 */
export async function exigirVlanUnica(
    trx: TransactionClientContract,
    datos: { router_id: number; interfaz_padre: string; vlan_id: number; nombre: string },
    exceptoId?: number,
) {
    await exigirUnico(
        trx,
        'network.vlans',
        (q) =>
            q
                .where('router_id', datos.router_id)
                .where('interfaz_padre', datos.interfaz_padre)
                .where('vlan_id', datos.vlan_id),
        'vlan_duplicada',
        `El router ya tiene la VLAN ${datos.vlan_id} en ${datos.interfaz_padre}`,
        exceptoId,
    )
    await exigirUnico(
        trx,
        'network.vlans',
        (q) => q.where('router_id', datos.router_id).whereRaw('lower(nombre) = lower(?)', [datos.nombre]),
        'nombre_interfaz_duplicado',
        `El router ya tiene una VLAN llamada «${datos.nombre}»: elige otro nombre`,
        exceptoId,
    )
}

/**
 * Máximo 2 VLAN por puerto PON: bloquea la fila del puerto para que dos altas simultáneas no
 * pasen las dos (422 `puerto_pon_lleno`).
 */
export async function exigirCupoPuerto(
    trx: TransactionClientContract,
    puertoId: number,
    exceptoVlanId?: number,
) {
    const puerto = await trx.from('network.olt_puertos_pon').where('id', puertoId).forUpdate().first()
    if (!puerto) throw campo('puerto_pon_id', 'El puerto PON no existe', 'exists')
    const q = trx.from('network.vlans').where('puerto_pon_id', puertoId)
    if (exceptoVlanId) q.whereNot('id', exceptoVlanId)
    const [fila] = (await q.count('* as total')) as Array<{ total: string | number }>
    if (Number(fila?.total ?? 0) >= MAX_VLANS_POR_PUERTO) {
        const vista = await verPuertoPon(puertoId, trx)
        throw new ReglaNegocio(
            `El puerto PON ${vista.identificador} ya tiene ${MAX_VLANS_POR_PUERTO} VLAN (el máximo)`,
            'puerto_pon_lleno',
            [{ field: 'puerto_pon_id', rule: 'puerto_pon_lleno', message: 'Máximo 2 VLAN por puerto PON' }],
        )
    }
}

/**
 * Crea una VLAN **administrada** en un router: A2 la escribe en RouterOS con
 * `comment = argosisp:vlan:<id>` al recibir `red_acceso.cambiada`. Nombre por defecto `vlan<id>`.
 */
export default class CrearVlan extends DomainAction<EntradaCrearVlan, VlanVista> {
    readonly nombre = 'vlans.crear'

    protected async handle(input: EntradaCrearVlan, t: Transaccion): Promise<VlanVista> {
        await exigirRouter(t.trx, input.router_id)
        exigirEmpresa(t.ctx, input.empresa_id)
        const nombre = input.nombre ?? `vlan${input.vlan_id}`
        await exigirVlanUnica(t.trx, { ...input, nombre })
        if (input.puerto_pon_id) await exigirCupoPuerto(t.trx, input.puerto_pon_id)
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.vlans')
            .insert({
                router_id: input.router_id,
                empresa_id: input.empresa_id ?? null,
                interfaz_padre: input.interfaz_padre,
                vlan_id: input.vlan_id,
                nombre,
                puerto_pon_id: input.puerto_pon_id ?? null,
                mtu: input.mtu ?? null,
                estado: 'administrado',
                descripcion: input.descripcion ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('vlan', id)
        t.fijarEmpresa(input.empresa_id ?? t.ctx.empresaId ?? null)
        const vlan = await verVlan(id, t.trx)
        await t.registrarCambios({ tipo: 'vlan', id }, null, vlanParaAuditoria(vlan))
        await emitirRedAcceso(t, {
            router_id: vlan.router_id,
            empresa_id: vlan.empresa_id,
            entidad: 'vlan',
            entidad_id: id,
            accion: 'creada',
            estado: 'administrado',
            campos: [],
        })
        return vlan
    }
}
