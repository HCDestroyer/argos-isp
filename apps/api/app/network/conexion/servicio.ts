import { ReglaNegocio } from '#shared/errores'
import { esIpDocumentacion } from '#network/routeros/corte_router'
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
 * - `clientes_v6`, `walled_garden`, `dns_v4` y `dns_v6` pueden quedar vacíos (sin DNS, el script deja
 *   los del router). Un DNS de documentación (192.0.2.x, 2001:db8::…) da 422: no es un DNS real.
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
    'portal_fqdn',
    'walled_garden',
    'dns_v4',
    'dns_v6',
] as const

// `dns_v4`/`dns_v6` vacíos: el script deja los DNS que ya tiene el router (y se detiene si no tiene).
const PUEDEN_QUEDAR_VACIAS = new Set(['clientes_v6', 'walled_garden', 'dns_v4', 'dns_v6'])

export const variableEntorno = (nombre: string) => `ROUTERS_SERVICIO_${nombre.toUpperCase()}`

export function valoresServicio(
    router: Pick<RouterVista, 'interfaz_clientes'>,
    /** gateways efectivos (distintos) de las redes IPv4 del router */
    gateways: string[],
    entorno: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
    const leer = (clave: string) => entorno[clave]?.trim() || null
    const valores: Record<string, string> = {}
    const faltan: string[] = []
    for (const nombre of VARIABLES_SERVICIO) {
        let valor = nombre === 'ppp_local_v4' ? null : leer(variableEntorno(nombre))
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
            faltan.push(nombre === 'pppoe_interfaz' ? 'interfaz_clientes' : variableEntorno(nombre))
        } else valores[nombre] = valor
    }
    const documentacion = [valores.dns_v4, valores.dns_v6]
        .flatMap((v) => (v ?? '').split(','))
        .map((d) => d.trim())
        .filter((d) => d !== '' && esIpDocumentacion(d))
    if (documentacion.length > 0) {
        throw new ReglaNegocio(
            `${documentacion.join(', ')} son IPs de documentación, no DNS reales: el router no resolvería nada y el ` +
                'suspendido vería «sin internet». Pon los DNS de tu proveedor en ROUTERS_SERVICIO_DNS_V4 / _V6 (o ' +
                'déjalos vacíos para conservar los del router)',
            'dns_documentacion',
        )
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
