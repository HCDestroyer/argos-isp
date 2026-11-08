import { ReglaNegocio, type ErrorCampo } from '#shared/errores'
import { dnsDeDocumentacion } from '#network/conexion/dns'
import type { RouterVista } from '#network/consultas/routers'

/**
 * Valores del grupo `servicio` de `infra/mikrotik/variables.json` para `?incluir=servicio`
 * (`conexion-servicio.rsc.tpl`: PPPoE, perfiles y corte). Argos todavía no guarda estos datos por
 * router, así que salen del entorno de la API (`ROUTERS_SERVICIO_<NOMBRE>`, p. ej.
 * `ROUTERS_SERVICIO_POOL_V4_RANGOS`), salvo:
 *
 * - `ppp_local_v4` (el `local-address` de los perfiles `default` y `suspendido` del script): **nunca del
 *   entorno**; es el gateway efectivo de las redes IPv4 del router (`contratos/red-acceso.md` §2: el
 *   `gateway` o la primera IP utilizable). Sin redes, o con redes de gateways distintos, 422
 *   `servicio_incompleto` (con varios gateways el `local-address` lo pone Argos por servidor PPPoE);
 * - `pppoe_interfaz`: `interfaz_clientes` del router o `ROUTEROS_INTERFAZ_CLIENTES`;
 * - `susp_rate_limit`: `ROUTERS_SERVICIO_SUSP_RATE_LIMIT` o `ROUTEROS_SUSPENDIDO_RATE_LIMIT`
 *   (256k/256k, el del perfil de corte);
 * - `clientes_v6`, `walled_garden`, `dns_v4` y `dns_v6` pueden quedar vacíos. Sin `dns_v4` el script
 *   **no toca** los `servers` del DNS del router (usa los que ya tiene, más los dinámicos de la WAN) y
 *   solo asegura `allow-remote-requests=yes`, cerrado desde la WAN (`infra/mikrotik/README.md`, «DNS
 *   del router»). Con `dns_v4`, el script los pone como `servers` (y `dns_v6` detrás);
 * - un DNS de documentación (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32) en
 *   `ROUTERS_SERVICIO_DNS_V4` o `_V6` es un error: 422 `dns_documentacion` y no se genera el script.
 *
 * - `portal_v4`, `portal_v6` y `portal_puerto` (el `to-ports` del NAT de corte): con `portal` (la configuración «Portal de corte», `core.portal_corte`) salen
 *   de ahí y no del entorno; el entorno solo siembra esa configuración mientras nadie la guarda.
 *
 * - `corte_identificacion` y `corte_url` (`contratos/corte-identificacion.md` §5 bis): el modo del router
 *   (`network.routers.corte_identificacion`, `ip` por defecto) y la URL de `/corte` de la regla final de
 *   `/ip proxy access` (`corteUrlVigente`: `PORTAL_URL_PUBLICA` o el destino del NAT). Nunca del entorno.
 *   Sin URL va vacía, como en el reconciliador: el script arma la de `portal_v4` y, si tampoco hay, la
 *   regla final niega (`action=deny`); nunca queda el 3346 sin regla final.
 * - `corte_tunel_ip` y `corte_tunel_puerto` (`contratos/corte-identificacion.md` §5 ter.6): en modo `ip`
 *   con el túnel de corte habilitado (`destinoTunel`), el dst-nat del suspendido va a la IP del servidor en
 *   el túnel sin masquerade. Vacías = el dst-nat a `portal_v4` de siempre. Nunca del entorno del router.
 *
 * Nunca se inventan rangos ni direcciones: si falta alguno, 422 `servicio_incompleto` con la lista de
 * variables a definir. Los patrones los valida el render.
 */

export const VARIABLES_SERVICIO = [
    'pppoe_interfaz',
    'wan_interfaz',
    'ppp_local_v4',
    'pool_v4_rangos',
    'clientes_v4',
    'clientes_v6',
    'susp_rate_limit',
    'pool_v6_enlace_prefijo',
    'pool_v6_pd_prefijo',
    'portal_v4',
    'portal_v6',
    'portal_puerto',
    'portal_fqdn',
    'walled_garden',
    'dns_v4',
    'dns_v6',
    'corte_identificacion',
    'corte_url',
    'corte_tunel_ip',
    'corte_tunel_puerto',
] as const

const PUEDEN_QUEDAR_VACIAS = new Set(['clientes_v6', 'walled_garden', 'dns_v4', 'dns_v6'])

export const variableEntorno = (nombre: string) => `ROUTERS_SERVICIO_${nombre.toUpperCase()}`

export function valoresServicio(
    router: Pick<RouterVista, 'interfaz_clientes'>,
    /** gateways efectivos (distintos) de las redes IPv4 del router */
    gateways: string[],
    entorno: NodeJS.ProcessEnv = process.env,
    portal?: { portal_v4: string | null; portal_v6: string | null; portal_puerto: number },
    /** modo de identificación del cortado del router y URL de `/corte` (`corteUrlVigente`) */
    corte: {
        identificacion: 'ip' | 'codigo'
        url: string | null
        /** corte por el túnel WireGuard (`destinoTunel`, solo en modo `ip`); null/ausente = `portal_v4` */
        tunel?: { ip: string; puerto: number } | null
    } = { identificacion: 'ip', url: null },
): Record<string, string> {
    const leer = (clave: string) => entorno[clave]?.trim() || null
    const documentacion: ErrorCampo[] = (['dns_v4', 'dns_v6'] as const).flatMap((nombre) =>
        dnsDeDocumentacion(leer(variableEntorno(nombre))).map((ip) => ({
            field: variableEntorno(nombre),
            message: `${ip} es una IP de documentación (RFC 5737/3849), no un resolutor real`,
            rule: 'dns_documentacion',
        })),
    )
    if (documentacion.length > 0) {
        throw new ReglaNegocio(
            `${[...new Set(documentacion.map((e) => e.field))].join(' y ')} trae IPs de documentación ` +
                `(${documentacion.map((e) => e.message.split(' ')[0]).join(', ')}): con ellas el router no resuelve ` +
                'nada y la página de corte no carga. Pon los resolutores reales de tu red o deja la variable ' +
                'vacía para que el script no toque el DNS del router, y ejecuta `sudo argosisp levantar`',
            'dns_documentacion',
            documentacion,
        )
    }
    const valores: Record<string, string> = {}
    const faltan: string[] = []
    for (const nombre of VARIABLES_SERVICIO) {
        if (nombre === 'corte_identificacion') {
            valores[nombre] = corte.identificacion
            continue
        }
        if (nombre === 'corte_url') {
            valores[nombre] = corte.url ?? ''
            continue
        }
        if (nombre === 'corte_tunel_ip' || nombre === 'corte_tunel_puerto') {
            const tunel = corte.identificacion === 'ip' ? (corte.tunel ?? null) : null
            valores[nombre] = !tunel ? '' : nombre === 'corte_tunel_ip' ? tunel.ip : String(tunel.puerto)
            continue
        }
        let valor = nombre === 'ppp_local_v4' ? null : leer(variableEntorno(nombre))
        if (portal && (nombre === 'portal_v4' || nombre === 'portal_v6')) valor = portal[nombre]
        if (nombre === 'portal_puerto') valor = portal ? String(portal.portal_puerto) : (valor ?? '80')
        if (nombre === 'ppp_local_v4') {
            const unicos = [...new Set(gateways)]
            if (unicos.length === 1) valor = unicos[0]!
            else {
                faltan.push(
                    unicos.length === 0
                        ? 'una red IPv4 del router (su gateway es el local-address)'
                        : `un solo gateway en las redes del router (hay ${unicos.join(', ')}; con varios, Argos pone el local-address por servidor PPPoE)`,
                )
                continue
            }
        }
        if (nombre === 'pppoe_interfaz') {
            valor = router.interfaz_clientes ?? valor ?? leer('ROUTEROS_INTERFAZ_CLIENTES')
        }
        if (nombre === 'susp_rate_limit') {
            valor = valor ?? leer('ROUTEROS_SUSPENDIDO_RATE_LIMIT') ?? '256k/256k'
        }
        if (valor === null && PUEDEN_QUEDAR_VACIAS.has(nombre)) valor = ''
        if (valor === null) {
            faltan.push(
                nombre === 'pppoe_interfaz'
                    ? 'interfaz_clientes'
                    : portal && nombre === 'portal_v4'
                      ? 'la IPv4 del portal (Configuración → Portal de corte)'
                      : portal && nombre === 'portal_v6'
                        ? 'la IPv6 del portal (Configuración → Portal de corte)'
                        : variableEntorno(nombre),
            )
        } else valores[nombre] = valor
    }
    if (faltan.length > 0) {
        throw new ReglaNegocio(
            `Para incluir la configuración de servicio faltan datos del servidor: ${faltan.join(', ')}. ` +
                'Defínelos (o genera el script solo de conexión)',
            'servicio_incompleto',
        )
    }
    return valores
}
