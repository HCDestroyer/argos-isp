import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * `local-address` del PPPoE (`contratos/red-acceso.md` §2). La **única fuente** es
 * `network.redes_ipv4.gateway`: nunca se teclea ni se copia del perfil `default` del router.
 *
 * Lo usan A2 (perfiles y secrets de RouterOS) y la caché AAA (`red_acceso` de `aaa:user:*`).
 */

export interface LocalAddressServicio {
    local_address: string | null
    /** de dónde salió: la red de la IPv4 del servicio, la red de su servidor PPPoE, o ninguna */
    origen: 'red_ipv4' | 'servidor_pppoe' | null
    red_ipv4_id: number | null
    servidor_pppoe_id: number | null
}

/** SQL del `local-address` de un servicio `s` (alias): gateway de la red de su IPv4 o de su servidor. */
export function sqlLocalAddress(alias = 's'): string {
    return `COALESCE(
        (SELECT host(r.gateway) FROM network.ipv4_asignaciones a
           JOIN network.redes_ipv4 r ON r.id = a.red_id
          WHERE a.servicio_id = ${alias}.id AND a.fin IS NULL ORDER BY a.id DESC LIMIT 1),
        (SELECT host(r.gateway) FROM network.servidores_pppoe sp
           JOIN network.redes_ipv4 r ON r.id = sp.red_ipv4_id
          WHERE sp.id = ${alias}.servidor_pppoe_id
            AND NOT EXISTS (SELECT 1 FROM network.ipv4_asignaciones a
                             WHERE a.servicio_id = ${alias}.id AND a.fin IS NULL)))`
}

export async function localAddressServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<LocalAddressServicio> {
    const { rows } = (await cliente.rawQuery(
        `SELECT s.servidor_pppoe_id,
                a.red_id AS red_ip,
                host(ra.gateway) AS gateway_ip,
                sp.red_ipv4_id AS red_servidor,
                host(rs.gateway) AS gateway_servidor
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
            red_servidor: number | null
            gateway_servidor: string | null
        }>
    }
    const f = rows[0]
    const servidor = f && f.servidor_pppoe_id !== null ? Number(f.servidor_pppoe_id) : null
    if (!f) return { local_address: null, origen: null, red_ipv4_id: null, servidor_pppoe_id: null }
    if (f.red_ip !== null) {
        return {
            local_address: f.gateway_ip,
            origen: f.gateway_ip ? 'red_ipv4' : null,
            red_ipv4_id: Number(f.red_ip),
            servidor_pppoe_id: servidor,
        }
    }
    if (f.red_servidor !== null && f.gateway_servidor) {
        return {
            local_address: f.gateway_servidor,
            origen: 'servidor_pppoe',
            red_ipv4_id: Number(f.red_servidor),
            servidor_pppoe_id: servidor,
        }
    }
    return { local_address: null, origen: null, red_ipv4_id: null, servidor_pppoe_id: servidor }
}

/** `local-address` del perfil de un servidor PPPoE: el gateway de su red (o null). */
export async function localAddressServidor(
    servidorId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<string | null> {
    const fila = (await cliente
        .from('network.servidores_pppoe as sp')
        .leftJoin('network.redes_ipv4 as r', 'r.id', 'sp.red_ipv4_id')
        .where('sp.id', servidorId)
        .select(cliente.raw('host(r.gateway) AS gateway'))
        .first()) as { gateway: string | null } | null
    return fila?.gateway ?? null
}
