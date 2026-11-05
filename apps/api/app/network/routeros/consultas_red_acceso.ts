import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { ServidorArgos, VlanArgos } from '#network/routeros/red_acceso'
import { sqlHostGatewayEfectivo } from '#network/red_acceso/local_address'

/**
 * Lo que Argos dice de la red de acceso de un router (`network.vlans`, `network.servidores_pppoe`,
 * modelo de A1 en `contratos/red-acceso.md` §1), en bloque para el reconciliador. El `local_address`
 * de un servidor es el de `localAddressServidor` (gateway de su red).
 */

export interface RedAccesoArgos {
    vlans: VlanArgos[]
    servidores: ServidorArgos[]
}

export async function redAccesoDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<RedAccesoArgos> {
    const vlans = (await cliente
        .from('network.vlans')
        .where('router_id', routerId)
        .orderBy('id')
        .select(
            'id',
            'nombre',
            'vlan_id',
            'interfaz_padre',
            'mtu',
            'estado',
            'descripcion',
            'ros_id',
        )) as Array<Record<string, unknown>>
    const servidores = (await cliente
        .from('network.servidores_pppoe as s')
        .leftJoin('network.redes_ipv4 as r4', 'r4.id', 's.red_ipv4_id')
        .leftJoin('network.ipv6_pools as pe', 'pe.id', 's.ipv6_pool_enlace_id')
        .leftJoin('network.ipv6_pools as pd', 'pd.id', 's.ipv6_pool_delegacion_id')
        .where('s.router_id', routerId)
        .orderBy('s.id')
        .select(
            's.*',
            cliente.raw(
                `CASE WHEN r4.id IS NULL THEN NULL ELSE ${sqlHostGatewayEfectivo('r4')} END AS local_address`,
            ),
            'pe.nombre_en_router as pool_ipv6_enlace',
            'pd.nombre_en_router as pool_ipv6_delegacion',
        )) as Array<Record<string, unknown>>
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    const t = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
    return {
        vlans: vlans.map((v) => ({
            id: Number(v.id),
            nombre: String(v.nombre),
            vlan_id: Number(v.vlan_id),
            interfaz_padre: String(v.interfaz_padre),
            mtu: n(v.mtu),
            estado: v.estado === 'adoptado' ? 'adoptado' : 'administrado',
            descripcion: t(v.descripcion),
            ros_id: t(v.ros_id),
        })),
        servidores: servidores.map((s) => ({
            id: Number(s.id),
            nombre: String(s.nombre),
            interfaz: String(s.interfaz),
            service_name: String(s.service_name),
            estado: s.estado === 'adoptado' ? 'adoptado' : 'administrado',
            activo: s.activo !== false,
            perfil_base: t(s.perfil_base) ?? 'default',
            max_mtu: n(s.max_mtu) ?? 1480,
            max_mru: n(s.max_mru) ?? 1480,
            mrru: n(s.mrru),
            autenticacion: Array.isArray(s.autenticacion)
                ? (s.autenticacion as string[])
                : ['pap', 'chap', 'mschap1', 'mschap2'],
            keepalive_timeout: n(s.keepalive_timeout) ?? 10,
            una_sesion_por_host: s.una_sesion_por_host !== false,
            max_sesiones: n(s.max_sesiones),
            local_address: t(s.local_address),
            pool_ipv6_enlace: t(s.pool_ipv6_enlace),
            pool_ipv6_delegacion: t(s.pool_ipv6_delegacion),
            ros_id: t(s.ros_id),
        })),
    }
}
