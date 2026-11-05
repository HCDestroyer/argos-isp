import db from '@adonisjs/lucid/services/db'
import { Problema } from '#shared/errores'

/**
 * Inventario de la red de acceso leído del router (`contratos/red-acceso.md` §4 y §6). Lo lee A2
 * (`leerInventarioAcceso` en `#network/routeros/inventario_acceso`); A1 lo compara con lo
 * registrado (descubrir) y lo usa para adoptar. Nunca escribe en el router.
 */

export interface InterfazRouterOS {
    nombre: string
    /** `type` de RouterOS: `ether`, `vlan`, `bridge`, `sfp`… */
    tipo: string
    deshabilitada: boolean
}

export interface VlanRouterOS {
    ros_id: string
    nombre: string
    interfaz_padre: string
    vlan_id: number
    mtu: number | null
    deshabilitada: boolean
    comment: string | null
}

export interface ServidorRouterOS {
    ros_id: string
    /** `service-name` */
    service_name: string
    interfaz: string
    /** `default-profile` */
    perfil: string
    max_mtu: number | null
    max_mru: number | null
    mrru: number | null
    autenticacion: string[]
    keepalive_timeout: number | null
    una_sesion_por_host: boolean
    max_sesiones: number | null
    deshabilitado: boolean
    comment: string | null
}

export interface PerfilRouterOS {
    ros_id: string
    nombre: string
    local_address: string | null
    remote_address: string | null
    comment: string | null
}

export interface PoolIpv4RouterOS {
    ros_id: string
    nombre: string
    rangos: string
}

export interface PoolIpv6RouterOS {
    ros_id: string
    nombre: string
    prefijo: string
    tamano_prefijo: number
}

export interface InventarioRedAcceso {
    interfaces: InterfazRouterOS[]
    vlans: VlanRouterOS[]
    servidores_pppoe: ServidorRouterOS[]
    perfiles: PerfilRouterOS[]
    pools_ipv4: PoolIpv4RouterOS[]
    pools_ipv6: PoolIpv6RouterOS[]
}

export type LectorInventario = (routerId: number, requestId: string) => Promise<InventarioRedAcceso>

let lector: LectorInventario | null = null

/** Para pruebas (o un arranque que quiera otro lector): reemplaza el de A2. `null` lo quita. */
export function registrarLectorInventario(nuevo: LectorInventario | null): void {
    lector = nuevo
}

class DescubrirNoDisponible extends Problema {
    constructor() {
        super(
            501,
            'descubrir_no_disponible',
            'Descubrir no disponible',
            'Este servidor todavía no sabe leer la red de acceso del router (falta el lector de RouterOS)',
        )
    }
}

/** El lector registrado o el de A2 por import dinámico; 501 si no existe todavía. */
async function lectorActual(): Promise<LectorInventario> {
    if (lector) return lector
    try {
        const ruta = '#network/routeros/inventario_acceso'
        const modulo = (await import(ruta)) as { leerInventarioAcceso?: LectorInventario }
        if (typeof modulo.leerInventarioAcceso === 'function') return modulo.leerInventarioAcceso
    } catch (error) {
        // el módulo de A2 aún no existe (con el cargador de TS el error no trae `code`)
        const codigo = (error as { code?: string }).code
        const falta =
            codigo === 'ERR_MODULE_NOT_FOUND' ||
            /Cannot find module .*inventario_acceso/.test(String((error as Error).message ?? error))
        if (!falta) throw error
    }
    throw new DescubrirNoDisponible()
}

export async function leerInventario(routerId: number, requestId: string): Promise<InventarioRedAcceso> {
    return (await lectorActual())(routerId, requestId)
}

/*
|--------------------------------------------------------------------------
| Descubrir: inventario + lo que Argos ya tiene
|--------------------------------------------------------------------------
*/

export interface Diferencia {
    campo: string
    argos: unknown
    router: unknown
}

export interface MarcaArgos {
    estado: 'nuevo' | 'adoptado' | 'administrado'
    id: number | null
    diferencias: Diferencia[]
}

export interface DescubrimientoRedAcceso {
    router_id: number
    leido_en: string
    interfaces: InterfazRouterOS[]
    vlans: Array<VlanRouterOS & { argos: MarcaArgos }>
    servidores_pppoe: Array<ServidorRouterOS & { argos: MarcaArgos; red_ipv4_sugerida_id: number | null }>
    perfiles: PerfilRouterOS[]
    pools_ipv4: PoolIpv4RouterOS[]
    pools_ipv6: PoolIpv6RouterOS[]
    sin_router: Array<{ entidad: 'vlan' | 'servidor_pppoe'; id: number; nombre: string }>
}

interface FilaVlanArgos {
    id: number
    nombre: string
    interfaz_padre: string
    vlan_id: number
    mtu: number | null
    estado: 'administrado' | 'adoptado'
    ros_id: string | null
}

interface FilaServidorArgos {
    id: number
    nombre: string
    interfaz: string
    service_name: string
    max_mtu: number
    max_mru: number
    estado: 'administrado' | 'adoptado'
    ros_id: string | null
}

function diferencias(pares: Array<[string, unknown, unknown]>): Diferencia[] {
    return pares
        .filter(([, a, r]) => r !== null && r !== undefined && String(a ?? '') !== String(r))
        .map(([campo, argos, router]) => ({ campo, argos, router }))
}

/**
 * Empareja cada objeto del router con su fila de Argos: por `ros_id`, luego por el comment de
 * Argos (`argosisp:vlan:<id>` / `argosisp:pppoe:<id>`), luego por interfaz.
 */
export async function descubrirRedAcceso(
    routerId: number,
    requestId: string,
): Promise<DescubrimientoRedAcceso> {
    const inventario = await leerInventario(routerId, requestId)
    const vlansArgos = (await db
        .from('network.vlans')
        .where('router_id', routerId)
        .select('id', 'nombre', 'interfaz_padre', 'vlan_id', 'mtu', 'estado', 'ros_id')) as FilaVlanArgos[]
    const servidoresArgos = (await db
        .from('network.servidores_pppoe')
        .where('router_id', routerId)
        .select(
            'id',
            'nombre',
            'interfaz',
            'service_name',
            'max_mtu',
            'max_mru',
            'estado',
            'ros_id',
        )) as FilaServidorArgos[]
    const redes = (await db
        .from('network.redes_ipv4')
        .where('router_id', routerId)
        .whereNotNull('gateway')
        .select('id', db.raw('host(gateway) AS gateway'))) as Array<{ id: number; gateway: string }>

    const vistasV = new Set<number>()
    const vlans = inventario.vlans.map((v) => {
        const fila =
            vlansArgos.find((a) => a.ros_id && a.ros_id === v.ros_id) ??
            vlansArgos.find((a) => v.comment === `argosisp:vlan:${a.id}`) ??
            vlansArgos.find((a) => a.interfaz_padre === v.interfaz_padre && Number(a.vlan_id) === v.vlan_id)
        if (fila) vistasV.add(Number(fila.id))
        return {
            ...v,
            argos: fila
                ? {
                      estado: fila.estado,
                      id: Number(fila.id),
                      diferencias: diferencias([
                          ['nombre', fila.nombre, v.nombre],
                          ['interfaz_padre', fila.interfaz_padre, v.interfaz_padre],
                          ['vlan_id', fila.vlan_id, v.vlan_id],
                          ['mtu', fila.mtu, fila.mtu === null ? null : v.mtu],
                      ]),
                  }
                : { estado: 'nuevo' as const, id: null, diferencias: [] },
        }
    })

    const vistasS = new Set<number>()
    const servidores = inventario.servidores_pppoe.map((s) => {
        const fila =
            servidoresArgos.find((a) => a.ros_id && a.ros_id === s.ros_id) ??
            servidoresArgos.find((a) => s.comment === `argosisp:pppoe:${a.id}`) ??
            servidoresArgos.find((a) => a.interfaz.toLowerCase() === s.interfaz.toLowerCase())
        if (fila) vistasS.add(Number(fila.id))
        const perfil = inventario.perfiles.find((p) => p.nombre === s.perfil)
        const sugerida = perfil?.local_address
            ? (redes.find((r) => r.gateway === perfil.local_address)?.id ?? null)
            : null
        return {
            ...s,
            red_ipv4_sugerida_id: sugerida === null ? null : Number(sugerida),
            argos: fila
                ? {
                      estado: fila.estado,
                      id: Number(fila.id),
                      diferencias: diferencias([
                          ['interfaz', fila.interfaz, s.interfaz],
                          ['service_name', fila.service_name, s.service_name],
                          ['max_mtu', fila.max_mtu, s.max_mtu],
                          ['max_mru', fila.max_mru, s.max_mru],
                      ]),
                  }
                : { estado: 'nuevo' as const, id: null, diferencias: [] },
        }
    })

    return {
        router_id: routerId,
        leido_en: new Date().toISOString(),
        interfaces: inventario.interfaces,
        vlans,
        servidores_pppoe: servidores,
        perfiles: inventario.perfiles,
        pools_ipv4: inventario.pools_ipv4,
        pools_ipv6: inventario.pools_ipv6,
        sin_router: [
            ...vlansArgos
                .filter((a) => !vistasV.has(Number(a.id)))
                .map((a) => ({ entidad: 'vlan' as const, id: Number(a.id), nombre: a.nombre })),
            ...servidoresArgos
                .filter((a) => !vistasS.has(Number(a.id)))
                .map((a) => ({ entidad: 'servidor_pppoe' as const, id: Number(a.id), nombre: a.nombre })),
        ],
    }
}
