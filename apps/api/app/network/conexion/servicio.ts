import { ReglaNegocio } from '#shared/errores'
import type { RouterVista } from '#network/consultas/routers'

/**
 * Valores del grupo `servicio` de `infra/mikrotik/variables.json` para `?incluir=servicio`
 * (`conexion-servicio.rsc.tpl`: PPPoE, perfiles y corte). Argos todavía no guarda estos datos por
 * router, así que salen del entorno de la API (`ROUTERS_SERVICIO_<NOMBRE>`, p. ej.
 * `ROUTERS_SERVICIO_PPP_LOCAL_V4`), salvo:
 *
 * - `pppoe_interfaz`: `interfaz_clientes` del router o `ROUTEROS_INTERFAZ_CLIENTES`;
 * - `susp_rate_limit`: `ROUTERS_SERVICIO_SUSP_RATE_LIMIT` o `ROUTEROS_SUSPENDIDO_RATE_LIMIT`
 *   (256k/256k, el del perfil de corte);
 * - `clientes_v6`, `walled_garden` y `dns_v6` pueden quedar vacíos.
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

const PUEDEN_QUEDAR_VACIAS = new Set(['clientes_v6', 'walled_garden', 'dns_v6'])

export const variableEntorno = (nombre: string) => `ROUTERS_SERVICIO_${nombre.toUpperCase()}`

export function valoresServicio(
    router: Pick<RouterVista, 'interfaz_clientes'>,
    entorno: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
    const leer = (clave: string) => entorno[clave]?.trim() || null
    const valores: Record<string, string> = {}
    const faltan: string[] = []
    for (const nombre of VARIABLES_SERVICIO) {
        let valor = leer(variableEntorno(nombre))
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
    if (faltan.length > 0) {
        throw new ReglaNegocio(
            `Para incluir la configuración de servicio faltan datos del servidor: ${faltan.join(', ')}. ` +
                'Defínelos (o genera el script solo de conexión)',
            'servicio_incompleto',
        )
    }
    return valores
}
