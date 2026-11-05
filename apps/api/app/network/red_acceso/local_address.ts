import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { sqlGatewayEfectivo } from '#network/ocupacion'

/**
 * `local-address` del PPPoE (`contratos/red-acceso.md` §2). La **única fuente** es la red IPv4: su
 * `gateway` o, si no lo tiene, la primera IP utilizable (decisión del PM, 5 nov; `derivado: true`).
 * Nunca se teclea ni se copia del perfil `default` del router; la IPAM nunca la entrega a un cliente.
 *
 * Lo usan A2 (perfiles y secrets de RouterOS) y la caché AAA (`red_acceso` de `aaa:user:*`).
 */

export interface LocalAddressServicio {
    local_address: string | null
    /** true = la red no tiene gateway y es su primera IP utilizable */
    derivado: boolean
    /** de dónde salió: la red de la IPv4 del servicio, la red de su servidor PPPoE, o ninguna */
    origen: 'red_ipv4' | 'servidor_pppoe' | null
    red_ipv4_id: number | null
    servidor_pppoe_id: number | null
}

/** SQL (texto) del gateway efectivo de la red `r`. */
export const sqlHostGatewayEfectivo = (r = 'r') => `host(${sqlGatewayEfectivo(r)})`

/** SQL del `local-address` de un servicio `s` (alias): gateway efectivo de la red de su IPv4 o de su servidor. */
export function sqlLocalAddress(alias = 's'): string {
    return `COALESCE(
        (SELECT ${sqlHostGatewayEfectivo('r')} FROM network.ipv4_asignaciones a
           JOIN network.redes_ipv4 r ON r.id = a.red_id
          WHERE a.servicio_id = ${alias}.id AND a.fin IS NULL ORDER BY a.id DESC LIMIT 1),
        (SELECT ${sqlHostGatewayEfectivo('r')} FROM network.servidores_pppoe sp
           JOIN network.redes_ipv4 r ON r.id = sp.red_ipv4_id
          WHERE sp.id = ${alias}.servidor_pppoe_id
            AND NOT EXISTS (SELECT 1 FROM network.ipv4_asignaciones a
                             WHERE a.servicio_id = ${alias}.id AND a.fin IS NULL)))`
}

/** SQL: la red del `local-address` del servicio `s` no tiene gateway (es derivado). */
export function sqlLocalAddressDerivado(alias = 's'): string {
    return `COALESCE(
        (SELECT r.gateway IS NULL FROM network.ipv4_asignaciones a
           JOIN network.redes_ipv4 r ON r.id = a.red_id
          WHERE a.servicio_id = ${alias}.id AND a.fin IS NULL ORDER BY a.id DESC LIMIT 1),
        (SELECT r.gateway IS NULL FROM network.servidores_pppoe sp
           JOIN network.redes_ipv4 r ON r.id = sp.red_ipv4_id
          WHERE sp.id = ${alias}.servidor_pppoe_id),
        false)`
}

export async function localAddressServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<LocalAddressServicio> {
    const { rows } = (await cliente.rawQuery(
        `SELECT s.servidor_pppoe_id,
                a.red_id AS red_ip,
                ${sqlHostGatewayEfectivo('ra')} AS gateway_ip,
                ra.gateway IS NULL AS derivado_ip,
                sp.red_ipv4_id AS red_servidor,
                ${sqlHostGatewayEfectivo('rs')} AS gateway_servidor,
                rs.gateway IS NULL AS derivado_servidor
           FROM core.servicios s
           LEFT JOIN LATERAL (SELECT x.red_id FROM network.ipv4_asignaciones x
                               WHERE x.servicio_id = s.id AND x.fin IS NULL ORDER BY x.id DESC LIMIT 1) a ON true
           LEFT JOIN network.redes_ipv4 ra ON ra.id = a.red_id
           LEFT JOIN network.servidores_pppoe sp ON sp.id = s.servidor_pppoe_id
           LEFT JOIN network.redes_ipv4 rs ON rs.id = sp.red_ipv4_id
          WHERE s.id = ?`,
        [servicioId],
    )) as {
        rows: Array<{
            servidor_pppoe_id: number | null
            red_ip: number | null
            gateway_ip: string | null
            derivado_ip: boolean
            red_servidor: number | null
            gateway_servidor: string | null
            derivado_servidor: boolean
        }>
    }
    const f = rows[0]
    const ninguno = { local_address: null, derivado: false, origen: null, red_ipv4_id: null }
    if (!f) return { ...ninguno, servidor_pppoe_id: null }
    const servidor = f.servidor_pppoe_id === null ? null : Number(f.servidor_pppoe_id)
    if (f.red_ip !== null) {
        return {
            local_address: f.gateway_ip,
            derivado: Boolean(f.derivado_ip),
            origen: 'red_ipv4',
            red_ipv4_id: Number(f.red_ip),
            servidor_pppoe_id: servidor,
        }
    }
    if (f.red_servidor !== null) {
        return {
            local_address: f.gateway_servidor,
            derivado: Boolean(f.derivado_servidor),
            origen: 'servidor_pppoe',
            red_ipv4_id: Number(f.red_servidor),
            servidor_pppoe_id: servidor,
        }
    }
    return { ...ninguno, servidor_pppoe_id: servidor }
}

/** `local-address` del perfil de un servidor PPPoE: el gateway efectivo de su red (o null sin red). */
export async function localAddressServidor(
    servidorId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<{ local_address: string | null; derivado: boolean }> {
    const fila = (await cliente
        .from('network.servidores_pppoe as sp')
        .leftJoin('network.redes_ipv4 as r', 'r.id', 'sp.red_ipv4_id')
        .where('sp.id', servidorId)
        .select(
            cliente.raw(
                `CASE WHEN r.id IS NULL THEN NULL ELSE ${sqlHostGatewayEfectivo('r')} END AS gateway`,
            ),
            cliente.raw('(r.id IS NOT NULL AND r.gateway IS NULL) AS derivado'),
        )
        .first()) as { gateway: string | null; derivado: boolean } | null
    return { local_address: fila?.gateway ?? null, derivado: Boolean(fila?.derivado) }
}
