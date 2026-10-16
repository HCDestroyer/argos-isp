import type { Schema } from '@argosisp/contracts'
import { bd } from '../bd'

type VistaPreviaControl = Schema<'VistaPreviaControl'>
type Control = VistaPreviaControl['a']
type Objeto = VistaPreviaControl['crear'][number]

/** Servicios por lote del worker (`LOTE_CAMBIO_CONTROL` en `app/network/routeros/cambio_control.ts`). */
const LOTE = 50

const SENTIDOS = ['bajada', 'subida', 'limitado:bajada', 'limitado:subida'] as const

/**
 * Objetos de ArgosIsp en el router para un modo, con los mismos `ruta`, `clave` y `nombre` que
 * devuelve la API real (capturados de `GET /routers/1/vista-previa-control?a=arbol_pcq` contra
 * `pnpm demo:datos`). `arbol_pcq`: tipos PCQ, árbol global + hijos por plan, mangle IPv4/IPv6 por
 * plan y las listas de cada servicio activo o limitado (WISP, o PPPoE con sesión abierta).
 * `simple`: solo las colas simples estáticas de WISP (las de PPPoE son dinámicas, por RADIUS).
 */
function objetos(routerId: number, modo: Control): Map<string, Objeto> {
    const salida = new Map<string, Objeto>()
    const agregar = (ruta: string, clave: string, nombre: string | null) => salida.set(`${ruta}|${clave}`, { ruta, clave, nombre })
    const planes = bd.planesPorRouter[routerId] ?? []
    const servicios = bd.servicios.filter(servicio => servicio.router_id === routerId && servicio.estado !== 'retirado')
    if (modo === 'arbol_pcq') {
        for (const plan of planes) {
            for (const sentido of SENTIDOS) {
                const nombre = `argosisp-plan-${plan}-${sentido.replace(':', '-')}`
                agregar('/queue/type', nombre, nombre)
            }
        }
        agregar('/queue/tree', 'argosisp:global:bajada', 'argosisp-global-bajada')
        agregar('/queue/tree', 'argosisp:global:subida', 'argosisp-global-subida')
        for (const plan of planes) {
            for (const sentido of SENTIDOS) {
                agregar('/queue/tree', `argosisp:plan:${plan}:${sentido}`, `argosisp-plan-${plan}-${sentido.replace(':', '-')}`)
            }
        }
        for (const plan of planes) {
            for (const sentido of SENTIDOS) {
                agregar('/ip/firewall/mangle', `argosisp:plan:${plan}:${sentido}`, null)
                agregar('/ipv6/firewall/mangle', `argosisp:plan:${plan}:${sentido}`, null)
            }
        }
        for (const servicio of servicios) {
            const conSesion = bd.sesiones.some(sesion => sesion.servicio_id === servicio.id && sesion.fin === null)
            const enLista = servicio.estado === 'activo' || servicio.estado === 'limitado'
            if (!enLista || (servicio.tipo_conexion === 'pppoe' && !conSesion)) {
                continue
            }
            const lista = `argosisp-plan-${servicio.plan_id}${servicio.estado === 'limitado' ? '-limitado' : ''}`
            agregar('/ip/firewall/address-list', `argosisp:servicio:${servicio.id}`, lista)
            if (servicio.prefijo_enlace_v6) {
                agregar('/ipv6/firewall/address-list', `argosisp:servicio:${servicio.id}:enlace`, lista)
            }
            if (servicio.prefijo_delegado_v6) {
                agregar('/ipv6/firewall/address-list', `argosisp:servicio:${servicio.id}:delegado`, lista)
            }
        }
    }
    else {
        for (const servicio of servicios.filter(s => s.tipo_conexion !== 'pppoe')) {
            agregar('/queue/simple', `argosisp:servicio:${servicio.id}`, servicio.user_ppp ?? `servicio-${servicio.id}`)
        }
    }
    return salida
}

/** `GET /routers/:id/vista-previa-control?a=` calculado sobre `bd`, como `vistaPreviaControl` de A2. */
export function vistaPreviaControl(router: Schema<'Router'>, a: Control): VistaPreviaControl {
    const de: Control = router.control_velocidad ?? (router.modo_velocidad === 'pcq' ? 'arbol_pcq' : 'simple')
    const servicios = bd.servicios.filter(servicio => servicio.router_id === router.id && servicio.estado !== 'retirado')
    const antes = de === a ? new Map<string, Objeto>() : objetos(router.id, de)
    const despues = de === a ? new Map<string, Objeto>() : objetos(router.id, a)
    const crear = [...despues].filter(([clave]) => !antes.has(clave)).map(([, objeto]) => objeto)
    const borrar = [...antes].filter(([clave]) => !despues.has(clave)).map(([, objeto]) => objeto)
    const menus = new Map<string, VistaPreviaControl['menus'][number]>()
    for (const [lista, campo] of [[crear, 'crear'], [borrar, 'borrar']] as const) {
        for (const objeto of lista) {
            const menu = menus.get(objeto.ruta) ?? { ruta: objeto.ruta, crear: 0, actualizar: 0, borrar: 0 }
            menu[campo]++
            menus.set(objeto.ruta, menu)
        }
    }
    const sesiones = servicios.filter(servicio => servicio.tipo_conexion === 'pppoe'
        && bd.sesiones.some(sesion => sesion.servicio_id === servicio.id && sesion.fin === null))
    return {
        router_id: router.id,
        de,
        a,
        servicios: servicios.length,
        lotes: de === a ? 0 : Math.ceil(servicios.length / LOTE),
        sesiones_a_desconectar: de === a ? 0 : sesiones.length,
        menus: [...menus.values()].sort((x, y) => x.ruta.localeCompare(y.ruta, 'en')),
        crear,
        actualizar: [],
        borrar,
    }
}
