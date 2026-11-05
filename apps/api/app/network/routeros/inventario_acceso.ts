import { routerDispatcher } from '#network/routeros/consultas'
import { bitacoraRed, fabricaPorDefecto, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { ErrorRouterOS, RouterOSInalcanzable } from '#network/routeros/errores'
import type { ClienteRouterOS, ObjetoRouterOS, RutaLectura, RutaRouterOS } from '#network/routeros/cliente'
import { inventarioDe, type LecturaRedAcceso } from '#network/routeros/red_acceso'
import type { InventarioRedAcceso } from '#network/red_acceso/inventario'
import { Problema } from '#shared/errores'

/**
 * Descubrir la red de acceso de un router (`contratos/red-acceso.md` §4 y §6.2): lee una vez
 * `/interface`, `/interface/vlan`, `/interface/pppoe-server/server`, `/ppp/profile`, `/ip/pool` y
 * `/ipv6/pool` y arma el inventario con la marca de Argos de cada objeto (comment `argosisp:`). Solo
 * lectura: no escribe nada en el router. Cada GET queda en `audit.red` (`metodo = GET`, sin servicio).
 *
 * A1 la carga por import dinámico desde `GET /routers/:id/red-acceso/descubrir`; empareja con sus
 * filas (`ros_id`, comment, interfaz) y arma `DescubrimientoRedAcceso`.
 */

/** El router no respondió, no existe o no tiene credenciales: 502 `router_no_responde` (RFC 9457). */
export class RouterNoResponde extends Problema {
    constructor(
        readonly routerId: number,
        detalle: string,
    ) {
        super(502, 'router_no_responde', 'El router no responde', detalle)
    }
}

/** Menús que se leen, en orden. */
export const MENUS_INVENTARIO = [
    '/interface',
    '/interface/vlan',
    '/interface/pppoe-server/server',
    '/ppp/profile',
    '/ip/pool',
    '/ipv6/pool',
] as const

async function leer(
    cliente: ClienteRouterOS,
    ruta: (typeof MENUS_INVENTARIO)[number],
    routerId: number,
    requestId: string,
): Promise<ObjetoRouterOS[]> {
    const inicio = performance.now()
    try {
        const lista = await cliente.listar(ruta as RutaRouterOS | RutaLectura)
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: routerId,
            servicio_id: null,
            comando: { metodo: 'GET', ruta, operacion: 'inventario_acceso', request_id: requestId },
            respuesta: { status: 200, objetos: lista.length, rtt_ms: Math.round(performance.now() - inicio) },
            ok: true,
        })
        return lista
    } catch (error) {
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: routerId,
            servicio_id: null,
            comando: { metodo: 'GET', ruta, operacion: 'inventario_acceso', request_id: requestId },
            respuesta: { error: (error as Error).message },
            ok: false,
        })
        throw error
    }
}

export async function leerInventarioAcceso(
    routerId: number,
    requestId: string,
    opciones: OpcionesDispatcher = {},
): Promise<InventarioRedAcceso> {
    const router = await routerDispatcher(routerId, undefined, opciones.red)
    if (!router) throw new RouterNoResponde(routerId, `el router ${routerId} no existe`)
    if (!router.con_credenciales) {
        throw new RouterNoResponde(routerId, `el router ${routerId} no tiene credenciales de la API REST`)
    }
    const cliente = (opciones.clientes ?? fabricaPorDefecto)(router.api)
    try {
        const l: Partial<Record<keyof LecturaRedAcceso, ObjetoRouterOS[]>> = {}
        const claves: Array<keyof LecturaRedAcceso> = [
            'interfaces',
            'vlans',
            'servidores',
            'perfiles',
            'pools_ipv4',
            'pools_ipv6',
        ]
        for (const [i, ruta] of MENUS_INVENTARIO.entries()) {
            l[claves[i]!] = await leer(cliente, ruta, routerId, requestId)
        }
        return inventarioDe(l as LecturaRedAcceso)
    } catch (error) {
        if (error instanceof RouterOSInalcanzable || error instanceof ErrorRouterOS) {
            throw new RouterNoResponde(routerId, `el router ${routerId} no respondió: ${error.message}`)
        }
        throw error
    } finally {
        cliente.cerrar()
    }
}
