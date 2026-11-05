import { routerDispatcher } from '#network/routeros/consultas'
import { bitacoraRed, fabricaPorDefecto, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { ErrorRouterOS, RouterOSInalcanzable } from '#network/routeros/errores'
import type {
    ClienteRouterOS,
    ObjetoRouterOS,
    Propiedades,
    RutaLectura,
    RutaRouterOS,
} from '#network/routeros/cliente'
import { inventarioDe, type LecturaRedAcceso } from '#network/routeros/red_acceso'
import type {
    CambioTomarControl,
    DiffTomarControl,
    InventarioRedAcceso,
    ObjetoTomarControl,
} from '#network/red_acceso/inventario'
import { createHash } from 'node:crypto'
import { estadoRedAcceso, MENUS_ACCESO } from '#network/routeros/red_acceso'
import { objetosDe, type LecturaAcceso } from '#network/routeros/aplicar_red_acceso'
import { redAccesoDeRouter } from '#network/routeros/consultas_red_acceso'
import { mismoValor } from '#network/routeros/normalizar'
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
    ruta: (typeof MENUS_INVENTARIO)[number] | '/interface/pppoe-server',
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

/**
 * Vista previa de «tomar control» de una VLAN o un servidor PPPoE adoptado (`contratos/red-acceso.md`
 * §4.1): lee el router (cada GET en `audit.red`) y compara lo que hay con lo que Argos escribiría para
 * esa fila ya administrada (comment `argosisp:…`, perfil `argosisp-pppoe-<id>` con el gateway efectivo,
 * MTU/MRU, autenticación). No escribe nada.
 *
 * - `huella`: sha256 de las propiedades leídas de los objetos implicados (y de su ausencia): estable si
 *   el router no cambió; A1 la compara al confirmar (409 `router_cambio`).
 * - `sesiones`: sesiones abiertas en el servidor (`/interface/pppoe-server`, `service` = su
 *   service-name). Cambiar su perfil no las corta: las nuevas entran con el de Argos.
 */
export async function vistaPreviaTomarControl(
    objeto: ObjetoTomarControl,
    requestId: string,
    opciones: OpcionesDispatcher = {},
): Promise<DiffTomarControl> {
    const router = await routerDispatcher(objeto.router_id, undefined, opciones.red)
    if (!router) throw new RouterNoResponde(objeto.router_id, `el router ${objeto.router_id} no existe`)
    if (!router.con_credenciales) {
        throw new RouterNoResponde(
            objeto.router_id,
            `el router ${objeto.router_id} no tiene credenciales de la API REST`,
        )
    }
    const acceso = await redAccesoDeRouter(objeto.router_id)
    const como = <T extends { id: number; estado: string }>(lista: T[]) =>
        lista.filter((x) => x.id === objeto.id).map((x) => ({ ...x, estado: 'administrado' as const }))
    const vlans = objeto.entidad === 'vlan' ? como(acceso.vlans) : []
    const servidores = objeto.entidad === 'servidor_pppoe' ? como(acceso.servidores) : []
    if (vlans.length + servidores.length === 0) {
        throw new RouterNoResponde(objeto.router_id, `${objeto.entidad} ${objeto.id} no es de este router`)
    }
    for (const v of vlans) v.ros_id = objeto.ros_id ?? v.ros_id ?? null
    for (const s of servidores) s.ros_id = objeto.ros_id ?? s.ros_id ?? null

    const cliente = (opciones.clientes ?? fabricaPorDefecto)(router.api)
    try {
        const lectura: LecturaAcceso = new Map()
        for (const ruta of MENUS_ACCESO) {
            lectura.set(ruta, await leer(cliente, ruta, objeto.router_id, requestId))
        }
        const { presentes, avisos } = estadoRedAcceso(vlans, servidores, lectura.get('/ppp/profile') ?? [])
        const advertencias = [...avisos]
        const cambios: CambioTomarControl[] = []
        const leido: Array<{ ruta: string; objeto: ObjetoRouterOS | null }> = []
        for (const o of presentes) {
            const { actuales } = objetosDe(lectura, o)
            const actual = actuales[0] ?? null
            leido.push({ ruta: o.ruta, objeto: actual })
            if (o.ros_id && !actual) {
                advertencias.push(`${o.ruta} ${o.ros_id}: ya no está en el router; Argos lo crearía`)
            }
            const deseadas: Propiedades = { ...o.propiedades, comment: o.comment }
            const propiedades: CambioTomarControl['propiedades'] = []
            for (const [k, v] of Object.entries(deseadas)) {
                if (!actual || !mismoValor(v, actual[k])) {
                    propiedades.push({ propiedad: k, actual: actual?.[k] ?? null, deseado: v })
                }
            }
            for (const k of o.quitar ?? []) {
                if (actual?.[k]) propiedades.push({ propiedad: k, actual: actual[k]!, deseado: null })
            }
            if (actual && propiedades.length === 0) continue
            cambios.push({
                ruta: o.ruta,
                ros_id: actual?.['.id'] ?? null,
                nombre: deseadas.name ?? deseadas['service-name'] ?? o.comment,
                accion: actual ? 'actualizar' : 'crear',
                propiedades,
            })
        }
        let sesiones = 0
        if (servidores.length > 0) {
            const servicio = servidores[0]!.service_name
            const activas = await leer(cliente, '/interface/pppoe-server', objeto.router_id, requestId)
            sesiones = activas.filter((i) => i.service === servicio).length
        }
        const huella = createHash('sha256')
            .update(
                JSON.stringify(
                    leido.map((x) => ({
                        ruta: x.ruta,
                        objeto: x.objeto
                            ? Object.fromEntries(
                                  Object.entries(x.objeto).sort(([a], [b]) => a.localeCompare(b)),
                              )
                            : null,
                    })),
                ),
            )
            .digest('hex')
        return { huella, cambios, sesiones, advertencias }
    } catch (error) {
        if (error instanceof ErrorRouterOS) {
            throw new RouterNoResponde(
                objeto.router_id,
                `el router ${objeto.router_id} no respondió: ${error.message}`,
            )
        }
        throw error
    } finally {
        cliente.cerrar()
    }
}
