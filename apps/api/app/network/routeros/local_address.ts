/**
 * `local-address` de PPPoE (`contratos/pppoe-local.md` §2 bis, pedido del PM del 5 nov): sale
 * **siempre** del `gateway` de la red IPv4 (`network.redes_ipv4`) y nunca se copia del perfil
 * `default` del router ni se teclea. Funciones puras: con las redes que vienen de Postgres, qué
 * `local-address` lleva un secret o un perfil, o por qué no lleva ninguno (un aviso claro para la
 * reconciliación y la vista previa).
 *
 * | Objeto | `local-address` |
 * | --- | --- |
 * | `/ppp/secret` (router `api`) | gateway de la red de la IPv4 fija del servicio; sin IPv4 fija, el de la red del pool del plan |
 * | `/ppp/profile plan-<id>[-limitado]` | gateway de la red del pool del plan en el router; si no, el único gateway de las redes de sus servicios; si no, el único del router |
 * | `/ppp/profile suspendido` (corte) | el único gateway de las redes del router |
 *
 * Sin gateway derivable (red sin gateway, varias redes con gateways distintos, ninguna red) el
 * objeto **no lleva** `local-address` (si lo tenía, se quita con `unset`) y RouterOS usa el del
 * servidor PPPoE. MikroTik no tiene atributo RADIUS para el `local-address`: con RADIUS solo puede
 * vivir en el perfil (README de `routeros`, «local-address»).
 */

/** Red IPv4 de la que puede salir el `local-address`. */
export interface RedGateway {
    red_id: number
    cidr: string
    /** null = la red no tiene gateway definido */
    gateway: string | null
}

export type LocalAddress =
    | { gateway: string; red_id: number | null; aviso: null }
    | { gateway: null; red_id: number | null; aviso: string | null }

const sin = (aviso: string | null, red_id: number | null = null): LocalAddress => ({
    gateway: null,
    red_id,
    aviso,
})

/** Lee un `RedGateway` de una columna jsonb (`{ red_id, cidr, gateway }`) o null. */
export function leerRedGateway(valor: unknown): RedGateway | null {
    if (!valor || typeof valor !== 'object') return null
    const v = valor as Record<string, unknown>
    const id = Number(v.red_id)
    if (!Number.isInteger(id) || id <= 0 || typeof v.cidr !== 'string') return null
    const gateway = typeof v.gateway === 'string' && v.gateway !== '' ? v.gateway : null
    return { red_id: id, cidr: v.cidr, gateway }
}

/**
 * `local-address` del secret de un servicio (router `api`): la red de su IPv4 fija o, sin IPv4 fija,
 * la red del pool del plan en el router. `aviso` si la red no tiene gateway.
 */
export function localAddressServicio(
    servicioId: number,
    red: RedGateway | null | undefined,
    redPool: RedGateway | null | undefined,
): LocalAddress {
    const r = red ?? redPool ?? null
    if (!r) return sin(null)
    if (r.gateway) return { gateway: r.gateway, red_id: r.red_id, aviso: null }
    return sin(
        `servicio ${servicioId}: la red ${r.cidr} no tiene gateway; el secret no lleva local-address ` +
            '(lo da el servidor PPPoE). Define el gateway de la red en Red → Pools',
        r.red_id,
    )
}

/** Gateways distintos de unas redes (sin repetir, en orden), y las redes sin gateway. */
function gatewaysDe(redes: RedGateway[]): { gateways: string[]; sinGateway: RedGateway[] } {
    const gateways: string[] = []
    const sinGateway: RedGateway[] = []
    const vistas = new Set<number>()
    for (const r of redes) {
        if (vistas.has(r.red_id)) continue
        vistas.add(r.red_id)
        if (!r.gateway) sinGateway.push(r)
        else if (!gateways.includes(r.gateway)) gateways.push(r.gateway)
    }
    return { gateways, sinGateway }
}

/**
 * Único gateway de unas redes (las del router, las de los servicios de un plan). null con un aviso
 * si hay varios o alguna red sin gateway; null sin aviso si no hay redes.
 */
export function gatewayUnico(redes: RedGateway[], quien: string): LocalAddress {
    if (redes.length === 0) return sin(null)
    const { gateways, sinGateway } = gatewaysDe(redes)
    if (sinGateway.length > 0) {
        return sin(
            `${quien}: la red ${sinGateway.map((r) => r.cidr).join(', ')} no tiene gateway; no lleva ` +
                'local-address (lo da el servidor PPPoE). Define el gateway de la red en Red → Pools',
        )
    }
    if (gateways.length > 1) {
        return sin(
            `${quien}: redes con gateways distintos (${gateways.join(', ')}); no lleva local-address ` +
                '(lo da el servidor PPPoE de cada VLAN)',
        )
    }
    const red = redes.find((r) => r.gateway === gateways[0])!
    return { gateway: gateways[0]!, red_id: red.red_id, aviso: null }
}

/** Datos de un plan en un router para el `local-address` de su perfil. */
export interface RedesPlan {
    /** Red cuyo `nombre` es el pool del plan en el router (`planes_routers.pool_ipv4`) */
    pool: RedGateway | null
    /** Redes de las IPv4 fijas de sus servicios PPPoE en el router */
    servicios: RedGateway[]
    /** Todas las redes IPv4 del router (respaldo si el plan no tiene ni pool ni servicios con IPv4) */
    router: RedGateway[]
}

/**
 * `local-address` del perfil `plan-<id>` (y su `-limitado`): el gateway de la red del pool del plan;
 * si no, el único de las redes de sus servicios; si no hay servicios con IPv4, el único del router.
 *
 * `modo = 'api'`: cada secret ya lleva el suyo, así que varias redes no son un problema (sin aviso).
 */
export function localAddressPerfil(planId: number, redes: RedesPlan, modo: 'radius' | 'api'): LocalAddress {
    const quien = `perfil plan-${planId}`
    if (redes.pool) {
        if (redes.pool.gateway) return { gateway: redes.pool.gateway, red_id: redes.pool.red_id, aviso: null }
        return sin(
            `${quien}: la red ${redes.pool.cidr} del pool del plan no tiene gateway; no lleva local-address ` +
                '(lo da el servidor PPPoE). Define el gateway de la red en Red → Pools',
            redes.pool.red_id,
        )
    }
    const base = redes.servicios.length > 0 ? redes.servicios : redes.router
    const unico = gatewayUnico(base, quien)
    if (unico.gateway === null && modo === 'api' && unico.aviso?.includes('gateways distintos')) {
        return sin(null)
    }
    return unico
}
