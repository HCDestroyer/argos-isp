import { isIP } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { ipAEntero, leerRedTunel, wireguardActivo } from '#network/conexion/config'

/**
 * Corte por el túnel WireGuard (`contratos/corte-identificacion.md` §5 ter, decisiones del PM P6 y P7).
 *
 * Un router en modo de identificación `ip` registrado en el túnel manda el HTTP de sus suspendidos a la
 * IP del servidor en el túnel (`10.255.0.1:PORTAL_CORTE_PUERTO`), sin masquerade: el portal ve la IP
 * del cliente. Para eso el peer del router en el servidor acepta sus redes de clientes (AllowedIPs).
 *
 * `corteTunelDeRouter` es la única regla de «¿este router usa el túnel para el corte?». La usan los
 * peers del agente, el estado deseado del router, el script de conexión y el diagnóstico, así que
 * nunca discrepan.
 */

export interface CorteTunel {
    /** IP del servidor en el túnel (la `.1` de `ARGOSISP_WG_RED`) */
    ip: string
    /** puerto del Caddy del corte en el servidor (`PORTAL_CORTE_PUERTO`, 8088) */
    puerto: number
}

export const PUERTO_CORTE_POR_DEFECTO = 8088
/** Prefijo más ancho que se acepta como red de clientes en AllowedIPs. */
export const PREFIJO_MINIMO_RED = 8

/** `PORTAL_CORTE_PUERTO`: el puerto dedicado del corte en el Caddy de Argos (8088). */
export function puertoCorte(entorno: NodeJS.ProcessEnv = process.env): number {
    const valor = Number(entorno.PORTAL_CORTE_PUERTO?.trim() || PUERTO_CORTE_POR_DEFECTO)
    return Number.isInteger(valor) && valor > 0 && valor < 65536 ? valor : PUERTO_CORTE_POR_DEFECTO
}

/** El túnel de corte está habilitado en esta instalación (WireGuard activo y `PORTAL_CORTE_TUNEL` ≠ 0). */
export function tunelCorteHabilitado(entorno: NodeJS.ProcessEnv = process.env): boolean {
    return wireguardActivo(entorno) && entorno.PORTAL_CORTE_TUNEL?.trim() !== '0'
}

/** Destino del corte en el túnel (sin mirar routers); null si el túnel de corte está apagado. */
export function destinoTunel(entorno: NodeJS.ProcessEnv = process.env): CorteTunel | null {
    if (!tunelCorteHabilitado(entorno)) return null
    try {
        return { ip: leerRedTunel(entorno.ARGOSISP_WG_RED).servidor, puerto: puertoCorte(entorno) }
    } catch {
        return null
    }
}

/**
 * SQL de «el router usa el túnel para el corte» sobre `network.routers r` y `network.routers_conexion c`:
 * activo, registrado en el túnel (clave pública) y en modo `ip` efectivo (en `codigo` sin credenciales
 * de API el reconciliador tampoco escribe el proxy: `modoCodigo` de `reconciliar_router.ts`).
 */
const SQL_USA_TUNEL = `
    r.activo
    AND c.public_key IS NOT NULL
    AND NOT (r.corte_identificacion = 'codigo' AND r.api_usuario IS NOT NULL AND r.api_password IS NOT NULL)
`

/** Destino del corte por el túnel para este router, o null (va al `portal_v4` de siempre). */
export async function corteTunelDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
    entorno: NodeJS.ProcessEnv = process.env,
): Promise<CorteTunel | null> {
    const destino = destinoTunel(entorno)
    if (!destino) return null
    const { rows } = (await cliente.rawQuery(
        `SELECT 1 FROM network.routers r
           JOIN network.routers_conexion c ON c.router_id = r.id
          WHERE r.id = ? AND ${SQL_USA_TUNEL}`,
        [routerId],
    )) as { rows: unknown[] }
    return rows.length > 0 ? destino : null
}

// --- Prefijos IPv4 ----------------------------------------------------------------------------------

interface Rango {
    cidr: string
    desde: number
    hasta: number
}

/** `a.b.c.d/n` normalizado a su red, con su rango; null si no es un CIDR IPv4. */
export function rangoV4(texto: string): Rango | null {
    const [ip, prefijoTexto] = texto.trim().split('/') as [string, string | undefined]
    if (isIP(ip) !== 4) return null
    const prefijo = prefijoTexto === undefined ? 32 : Number(prefijoTexto)
    if (!Number.isInteger(prefijo) || prefijo < 0 || prefijo > 32) return null
    const tamano = 2 ** (32 - prefijo)
    const desde = ipAEntero(ip) - (ipAEntero(ip) % tamano)
    const red = [24, 16, 8, 0].map((c) => Math.floor(desde / 2 ** c) % 256).join('.')
    return { cidr: `${red}/${prefijo}`, desde, hasta: desde + tamano - 1 }
}

function seTraslapan(a: Rango, b: Rango): boolean {
    return a.desde <= b.hasta && b.desde <= a.hasta
}

/** `ARGOSISP_WG_REDES_EXCLUIDAS`: CIDR separados por coma o espacio (la red de compose, por defecto). */
export function redesExcluidas(entorno: NodeJS.ProcessEnv = process.env): Rango[] {
    const texto =
        entorno.ARGOSISP_WG_REDES_EXCLUIDAS?.trim() || entorno.COMPOSE_SUBNET_V4?.trim() || '172.30.0.0/24'
    return texto
        .split(/[,\s]+/)
        .filter(Boolean)
        .flatMap((cidr) => rangoV4(cidr) ?? [])
}

// --- Peers --------------------------------------------------------------------------------------------

export interface PeerConRedes {
    router_id: number
    public_key: string
    ip_tunel: string
    /** `<ip_tunel>/32` y, si el router manda el corte por el túnel, sus redes de clientes IPv4 */
    allowed_ips: string[]
    /** Redes que se descartaron y por qué (el agente las escribe en su log) */
    avisos: string[]
}

export interface PeerBase {
    router_id: number
    public_key: string
    ip_tunel: string
    /** redes IPv4 de clientes del router (vacío si no usa el túnel para el corte) */
    redes: string[]
}

/**
 * AllowedIPs de cada peer (§5 ter.4). Descarta, con aviso, las redes que:
 * - no son un CIDR IPv4 o son más anchas que /8;
 * - se traslapan con la red del túnel o con `ARGOSISP_WG_REDES_EXCLUIDAS` (la red de compose);
 * - se traslapan con lo ya asignado a otro peer: WireGuard no admite AllowedIPs traslapados
 *   (`wg syncconf` le daría el prefijo al último sin avisar). Gana el router de menor id.
 * Pura: la prueban las unitarias sin base de datos.
 */
export function peersConRedes(peers: PeerBase[], entorno: NodeJS.ProcessEnv = process.env): PeerConRedes[] {
    let tunel: Rango | null = null
    try {
        tunel = rangoV4(leerRedTunel(entorno.ARGOSISP_WG_RED).cidr)
    } catch {
        tunel = null
    }
    const excluidas = redesExcluidas(entorno)
    const ordenados = [...peers].sort((a, b) => a.router_id - b.router_id)
    // Lo ya tomado por los peers anteriores (sus /32 y sus redes), con el router dueño
    const tomados: Array<{ rango: Rango; router_id: number }> = []
    for (const p of ordenados) {
        const propio = rangoV4(`${p.ip_tunel}/32`)
        if (propio) tomados.push({ rango: propio, router_id: p.router_id })
    }
    return ordenados.map((p) => {
        const avisos: string[] = []
        const allowed = [`${p.ip_tunel}/32`]
        for (const texto of p.redes) {
            const rango = rangoV4(texto)
            if (!rango) {
                avisos.push(`red ${texto}: no es una red IPv4, se omite`)
                continue
            }
            if (Number(rango.cidr.split('/')[1]) < PREFIJO_MINIMO_RED) {
                avisos.push(`red ${rango.cidr}: más ancha que /${PREFIJO_MINIMO_RED}, se omite`)
                continue
            }
            if (tunel && seTraslapan(rango, tunel)) {
                avisos.push(`red ${rango.cidr}: se traslapa con la red del túnel ${tunel.cidr}, se omite`)
                continue
            }
            const excluida = excluidas.find((e) => seTraslapan(rango, e))
            if (excluida) {
                avisos.push(
                    `red ${rango.cidr}: se traslapa con ${excluida.cidr} (ARGOSISP_WG_REDES_EXCLUIDAS), se omite`,
                )
                continue
            }
            const choque = tomados.find((t) => seTraslapan(rango, t.rango))
            if (choque) {
                avisos.push(
                    choque.router_id === p.router_id
                        ? `red ${rango.cidr}: repetida o dentro de otra red del mismo router, se omite`
                        : `red ${rango.cidr}: se traslapa con ${choque.rango.cidr} del router ${choque.router_id}, se omite`,
                )
                continue
            }
            tomados.push({ rango, router_id: p.router_id })
            allowed.push(rango.cidr)
        }
        return {
            router_id: p.router_id,
            public_key: p.public_key,
            ip_tunel: p.ip_tunel,
            allowed_ips: allowed,
            avisos,
        }
    })
}

/**
 * Peers vigentes con sus AllowedIPs (`GET /internal/wireguard/peers`): los de `listarPeers` más las
 * redes de clientes de los routers que mandan el corte por el túnel.
 */
export async function listarPeersConRedes(
    cliente: QueryClientContract = db.connection(),
    entorno: NodeJS.ProcessEnv = process.env,
): Promise<PeerConRedes[]> {
    const conTunel = destinoTunel(entorno) !== null
    const { rows } = (await cliente.rawQuery(
        `SELECT c.router_id, c.public_key, host(c.ip_tunel) AS ip_tunel,
                (${conTunel ? SQL_USA_TUNEL : 'false'}) AS usa_tunel,
                COALESCE((SELECT array_agg(n.cidr::text ORDER BY n.id) FROM network.redes_ipv4 n
                           WHERE n.router_id = r.id), '{}') AS redes
           FROM network.routers_conexion c
           JOIN network.routers r ON r.id = c.router_id
          WHERE c.public_key IS NOT NULL AND r.activo
          ORDER BY c.router_id`,
    )) as {
        rows: Array<{
            router_id: number | string
            public_key: string
            ip_tunel: string
            usa_tunel: boolean
            redes: string[]
        }>
    }
    return peersConRedes(
        rows.map((f) => ({
            router_id: Number(f.router_id),
            public_key: f.public_key,
            ip_tunel: f.ip_tunel,
            redes: f.usa_tunel ? f.redes : [],
        })),
        entorno,
    )
}

/**
 * `router.redes_cambiadas` por cada router (§5 ter.10): el `wireguard-agente` vuelve a pedir los peers.
 * Lo emiten las acciones que cambian las redes de un router (A1) y, de respaldo, el reconciliador.
 */
export async function emitirRedesCambiadas(t: Transaccion, routerIds: number[]): Promise<void> {
    for (const routerId of [...new Set(routerIds)].sort((a, b) => a - b)) {
        await t.emit('router.redes_cambiadas', { router_id: routerId, empresa_id: null })
    }
}
