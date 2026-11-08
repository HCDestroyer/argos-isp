import { isIP } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { resolverIp } from '#network/consultas/ip'
import { configIpOrigen, listaConfiables, normalizarIp } from '#portal/ip_origen'
import { servicioDelCodigoCorte } from '#portal/codigos_corte'

/**
 * Identificación del servicio en la página de corte (`contratos/corte-identificacion.md` §4.1).
 *
 * Precedencia:
 * 1. **Código de corte** (`?c=` / `X-Argos-Corte`, lo pone el proxy del router en modo `codigo`):
 *    vigente → ese servicio, sin mirar la IP.
 * 2. **IP de origen**, solo si no es de infraestructura: la IP de un router (`nas_ip`, `host` de la API,
 *    IP del túnel), del servidor (`PORTAL_IPS_SERVIDOR`) o de un proxy confiable
 *    (`PORTAL_PROXIES_CONFIABLES`) nunca identifica a nadie, aunque caiga en una asignación: es la
 *    señal de que hay NAT o un proxy en medio y mostraría los datos de otro cliente.
 * 3. **No identificado, con `motivo`** para que la página lo diga y ofrezca entrar con el código por
 *    teléfono o correo.
 */

export type MotivoNoIdentificado =
    /** llegó un código con formato válido que no existe o ya venció */
    | 'codigo_vencido'
    /** la IP es de un router: el router hace NAT (masquerade) hacia el portal */
    | 'ip_de_router'
    /** la IP es del servidor de Argos (hairpin o proxy local) */
    | 'ip_de_servidor'
    /** la IP es de un proxy o de la red de Docker: falta `ARGOSISP_PROXIES_CONFIABLES` o sobra un proxy */
    | 'ip_de_proxy'
    /** ninguna sesión ni asignación vigente tiene esa IP */
    | 'ip_desconocida'

export type IdentificadoPor = 'codigo' | 'ip'

/** Lo que trae la petición para identificarse. */
export interface OrigenPortal {
    ip: string
    /** código de corte normalizado (`normalizarCodigoCorte`); null = no trajo o no tenía formato */
    codigo?: string | null
    /** trajo un código sin formato válido (cuenta como `codigo_vencido` si la IP tampoco sirve) */
    codigoInvalido?: boolean
}

export interface Identificacion {
    servicioId: number | null
    por: IdentificadoPor | null
    motivo: MotivoNoIdentificado | null
}

/** Una IP suelta (las llamadas de antes) es un origen sin código. */
export function comoOrigen(origen: string | OrigenPortal): OrigenPortal {
    return typeof origen === 'string' ? { ip: origen } : origen
}

/** `PORTAL_IPS_SERVIDOR`: IPs o CIDR del propio servidor (separados por coma), p. ej. su IP pública. */
export function ipsServidor(entorno: NodeJS.ProcessEnv = process.env): string {
    return entorno.PORTAL_IPS_SERVIDOR ?? ''
}

function enLista(ip: string, texto: string, variable: string): boolean {
    if (!texto.trim()) return false
    return listaConfiables(texto, variable).check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}

/**
 * ¿La IP es de infraestructura (router, servidor, proxy)? El motivo, o null si puede ser de un cliente.
 */
export async function clasificarIp(
    ip: string,
    cliente: QueryClientContract = db.connection(),
): Promise<Extract<MotivoNoIdentificado, 'ip_de_router' | 'ip_de_servidor' | 'ip_de_proxy'> | null> {
    const normal = normalizarIp(ip)
    if (!normal) return null
    if (enLista(normal, configIpOrigen().proxiesConfiables, 'PORTAL_PROXIES_CONFIABLES')) return 'ip_de_proxy'
    if (enLista(normal, ipsServidor(), 'PORTAL_IPS_SERVIDOR')) return 'ip_de_servidor'
    const resultado = await cliente.rawQuery(
        `SELECT EXISTS (
             SELECT 1 FROM network.routers r
              WHERE r.nas_ip = ?::inet OR lower(r.host) = ? OR lower(r.host) = ?
         ) OR EXISTS (
             SELECT 1 FROM network.routers_conexion c WHERE c.ip_tunel = ?::inet
         ) AS es_router`,
        [normal, normal, `[${normal}]`, normal],
    )
    return (resultado.rows[0] as { es_router: boolean } | undefined)?.es_router ? 'ip_de_router' : null
}

/** Identifica el servicio de la petición con la precedencia de arriba. */
export async function identificarOrigen(
    origen: string | OrigenPortal,
    cliente: QueryClientContract = db.connection(),
): Promise<Identificacion> {
    const o = comoOrigen(origen)
    if (o.codigo) {
        const servicioId = await servicioDelCodigoCorte(o.codigo, cliente)
        if (servicioId) return { servicioId, por: 'codigo', motivo: null }
    }
    const conCodigoFallido = Boolean(o.codigo) || o.codigoInvalido === true
    const infra = await clasificarIp(o.ip, cliente)
    if (infra) return { servicioId: null, por: null, motivo: conCodigoFallido ? 'codigo_vencido' : infra }
    const resolucion = await resolverIp(o.ip, cliente)
    if (resolucion) return { servicioId: resolucion.servicio_id, por: 'ip', motivo: null }
    return { servicioId: null, por: null, motivo: conCodigoFallido ? 'codigo_vencido' : 'ip_desconocida' }
}
