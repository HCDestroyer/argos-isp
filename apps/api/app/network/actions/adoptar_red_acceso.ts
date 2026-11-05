import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    servidorParaAuditoria,
    verServidorPppoe,
    verVlan,
    vlanParaAuditoria,
    type ServidorPppoeVista,
    type VlanVista,
} from '#network/red_acceso/consultas'
import { leerInventario, type VlanRouterOS } from '#network/red_acceso/inventario'
import { emitirRedAcceso, exigirEmpresa, exigirRouter } from '#network/red_acceso/reglas'
import { exigirCupoPuerto, exigirVlanUnica } from '#network/actions/crear_vlan'
import { AUTENTICACIONES_PPPOE, validarServidorPppoe } from '#network/actions/crear_servidor_pppoe'

export interface VlanAAdoptar {
    ros_id: string
    puerto_pon_id?: number | null
    empresa_id?: number | null
    descripcion?: string | null
}

export interface ServidorAAdoptar {
    ros_id: string
    nombre?: string
    red_ipv4_id?: number | null
    ipv6_pool_enlace_id?: number | null
    ipv6_pool_delegacion_id?: number | null
    empresa_id?: number | null
    descripcion?: string | null
}

export interface EntradaAdoptarRedAcceso {
    router_id: number
    vlans?: VlanAAdoptar[]
    servidores_pppoe?: ServidorAAdoptar[]
}

export interface ResultadoAdopcion {
    vlans: VlanVista[]
    servidores_pppoe: ServidorPppoeVista[]
}

const entre = (valor: number | null, min: number, max: number, defecto: number) =>
    valor !== null && valor >= min && valor <= max ? valor : defecto

/**
 * Adopta VLAN y servidores PPPoE que ya existen en el router (`contratos/red-acceso.md` §4):
 * relee el inventario (A2) y crea las filas `adoptado` con los valores de RouterOS. **No toca el
 * router.** Un `ros_id` que ya no está → 409 `inventario_cambio`; uno ya registrado → 409
 * `ya_registrado`. La VLAN de un servidor adoptado se adopta con él si no estaba.
 */
export default class AdoptarRedAcceso extends DomainAction<EntradaAdoptarRedAcceso, ResultadoAdopcion> {
    readonly nombre = 'red_acceso.adoptar'

    protected async handle(input: EntradaAdoptarRedAcceso, t: Transaccion): Promise<ResultadoAdopcion> {
        await exigirRouter(t.trx, input.router_id)
        t.fijarEntidad('router', input.router_id)
        const inventario = await leerInventario(input.router_id, t.ctx.requestId)
        const resultado: ResultadoAdopcion = { vlans: [], servidores_pppoe: [] }
        const adoptadas = new Map<string, number>()

        const adoptarVlan = async (v: VlanRouterOS, extra: Omit<VlanAAdoptar, 'ros_id'>) => {
            const registrada = (await t.trx
                .from('network.vlans')
                .where('router_id', input.router_id)
                .where((q) =>
                    q
                        .where('ros_id', v.ros_id)
                        .orWhere((w) =>
                            w.where('interfaz_padre', v.interfaz_padre).where('vlan_id', v.vlan_id),
                        ),
                )
                .select('id')
                .first()) as { id: number } | null
            if (registrada) {
                throw new Conflicto(
                    `La VLAN «${v.nombre}» ya está registrada en Argos (${registrada.id})`,
                    'ya_registrado',
                )
            }
            exigirEmpresa(t.ctx, extra.empresa_id)
            await exigirVlanUnica(t.trx, { router_id: input.router_id, ...v })
            if (extra.puerto_pon_id) await exigirCupoPuerto(t.trx, extra.puerto_pon_id)
            const [fila] = (await t.trx
                .insertQuery()
                .table('network.vlans')
                .insert({
                    router_id: input.router_id,
                    empresa_id: extra.empresa_id ?? null,
                    interfaz_padre: v.interfaz_padre,
                    vlan_id: v.vlan_id,
                    nombre: v.nombre,
                    puerto_pon_id: extra.puerto_pon_id ?? null,
                    mtu: v.mtu !== null && v.mtu >= 576 && v.mtu <= 9216 ? v.mtu : null,
                    estado: 'adoptado',
                    ros_id: v.ros_id,
                    descripcion: extra.descripcion ?? null,
                })
                .returning('id')) as Array<{ id: number }>
            const vlan = await verVlan(Number(fila!.id), t.trx)
            await t.registrarCambios({ tipo: 'vlan', id: vlan.id }, null, vlanParaAuditoria(vlan))
            await emitirRedAcceso(t, {
                router_id: input.router_id,
                empresa_id: vlan.empresa_id,
                entidad: 'vlan',
                entidad_id: vlan.id,
                accion: 'adoptada',
                estado: 'adoptado',
                campos: [],
            })
            adoptadas.set(v.nombre.toLowerCase(), vlan.id)
            resultado.vlans.push(vlan)
            return vlan.id
        }

        for (const pedido of input.vlans ?? []) {
            const v = inventario.vlans.find((x) => x.ros_id === pedido.ros_id)
            if (!v) {
                throw new Conflicto(
                    `El router ya no tiene la VLAN ${pedido.ros_id}: vuelve a detectar`,
                    'inventario_cambio',
                )
            }
            await adoptarVlan(v, {
                puerto_pon_id: pedido.puerto_pon_id,
                empresa_id: pedido.empresa_id,
                descripcion: pedido.descripcion,
            })
        }

        for (const pedido of input.servidores_pppoe ?? []) {
            const s = inventario.servidores_pppoe.find((x) => x.ros_id === pedido.ros_id)
            if (!s) {
                throw new Conflicto(
                    `El router ya no tiene el servidor PPPoE ${pedido.ros_id}: vuelve a detectar`,
                    'inventario_cambio',
                )
            }
            const registrado = (await t.trx
                .from('network.servidores_pppoe')
                .where('router_id', input.router_id)
                .where((q) =>
                    q.where('ros_id', s.ros_id).orWhereRaw('lower(interfaz) = lower(?)', [s.interfaz]),
                )
                .select('id')
                .first()) as { id: number } | null
            if (registrado) {
                throw new Conflicto(
                    `El servidor PPPoE de «${s.interfaz}» ya está registrado en Argos (${registrado.id})`,
                    'ya_registrado',
                )
            }
            exigirEmpresa(t.ctx, pedido.empresa_id)
            // Si escucha en una VLAN: la de Argos (registrada o de este lote) o se adopta con él.
            let vlanId: number | null = adoptadas.get(s.interfaz.toLowerCase()) ?? null
            if (!vlanId) {
                const deArgos = (await t.trx
                    .from('network.vlans')
                    .where('router_id', input.router_id)
                    .whereRaw('lower(nombre) = lower(?)', [s.interfaz])
                    .select('id')
                    .first()) as { id: number } | null
                vlanId = deArgos ? Number(deArgos.id) : null
            }
            if (!vlanId) {
                const v = inventario.vlans.find((x) => x.nombre.toLowerCase() === s.interfaz.toLowerCase())
                if (v) vlanId = await adoptarVlan(v, { empresa_id: pedido.empresa_id })
            }
            const nombre = pedido.nombre ?? s.service_name
            await validarServidorPppoe(t.trx, input.router_id, 'adoptado', {
                nombre,
                vlan_id: vlanId,
                interfaz: s.interfaz,
                red_ipv4_id: pedido.red_ipv4_id,
                ipv6_pool_enlace_id: pedido.ipv6_pool_enlace_id,
                ipv6_pool_delegacion_id: pedido.ipv6_pool_delegacion_id,
            })
            const autenticacion = s.autenticacion.filter((a) =>
                (AUTENTICACIONES_PPPOE as readonly string[]).includes(a),
            )
            const [fila] = (await t.trx
                .insertQuery()
                .table('network.servidores_pppoe')
                .insert({
                    router_id: input.router_id,
                    empresa_id: pedido.empresa_id ?? null,
                    nombre,
                    vlan_id: vlanId,
                    interfaz: s.interfaz,
                    service_name: s.service_name,
                    red_ipv4_id: pedido.red_ipv4_id ?? null,
                    ipv6_pool_enlace_id: pedido.ipv6_pool_enlace_id ?? null,
                    ipv6_pool_delegacion_id: pedido.ipv6_pool_delegacion_id ?? null,
                    perfil_base: s.perfil || 'default',
                    perfil_router: s.perfil || null,
                    max_mtu: entre(s.max_mtu, 576, 9000, 1480),
                    max_mru: entre(s.max_mru, 576, 9000, 1480),
                    mrru: s.mrru !== null && s.mrru >= 1500 && s.mrru <= 65535 ? s.mrru : null,
                    autenticacion: autenticacion.length ? autenticacion : [...AUTENTICACIONES_PPPOE],
                    keepalive_timeout: entre(s.keepalive_timeout, 0, 3600, 10),
                    una_sesion_por_host: s.una_sesion_por_host,
                    max_sesiones: s.max_sesiones && s.max_sesiones > 0 ? s.max_sesiones : null,
                    estado: 'adoptado',
                    ros_id: s.ros_id,
                    activo: !s.deshabilitado,
                    descripcion: pedido.descripcion ?? null,
                })
                .returning('id')) as Array<{ id: number }>
            const servidor = await verServidorPppoe(Number(fila!.id), t.trx)
            await t.registrarCambios(
                { tipo: 'servidor_pppoe', id: servidor.id },
                null,
                servidorParaAuditoria(servidor),
            )
            await emitirRedAcceso(t, {
                router_id: input.router_id,
                empresa_id: servidor.empresa_id,
                entidad: 'servidor_pppoe',
                entidad_id: servidor.id,
                accion: 'adoptada',
                estado: 'adoptado',
                campos: [],
            })
            resultado.servidores_pppoe.push(servidor)
        }
        return resultado
    }
}
