import type { EstadoServicio } from '#shared/eventos'
import { rateLimitServicio, type VelocidadPlan } from '#network/velocidad'
import type { Propiedades, RutaRouterOS } from '#network/routeros/cliente'

/**
 * Estado deseado en el router de un servicio sin PPPoE (`contratos/routeros.md`). Función pura:
 * con los datos vigentes del servicio dice qué objetos deben existir (y con qué propiedades) y
 * cuáles no, todos identificados por `comment = argosisp:servicio:<id>`. El dispatcher lo aplica
 * con `asegurar`/`borrar`, así que un evento repetido o fuera de orden no deja basura.
 *
 * | Objeto | Cuándo |
 * | --- | --- |
 * | Cola simple (`/queue/simple`) | Siempre: rate-limit de `rateLimitServicio` según el estado; suspendido = el de PPPoE |
 * | Address-list `suspendidos` | Solo en `suspendido` (mismo NAT a `/corte` que PPPoE) |
 * | Lease DHCP | Solo en `dhcp_fija` (también suspendido: necesita su IP para llegar a `/corte`) |
 * | ARP estático | Solo con `amarre_ip_mac` y `mac` |
 *
 * Un servicio `pppoe`, `retirado`, inexistente o sin IPv4 no tiene nada en el router.
 */

/** Menús donde un servicio puede tener objetos (en este orden se aplican). */
export const RUTAS_SERVICIO = [
    '/queue/simple',
    '/ip/firewall/address-list',
    '/ip/dhcp-server/lease',
    '/ip/arp',
] as const satisfies readonly RutaRouterOS[]
export type RutaServicio = (typeof RUTAS_SERVICIO)[number]

export const PREFIJO_COMMENT_SERVICIO = 'argosisp:servicio:'

export function commentServicio(servicioId: number): string {
    return `${PREFIJO_COMMENT_SERVICIO}${servicioId}`
}

/** `argosisp:servicio:<id>` → id; null si el comment no es de un servicio. */
export function servicioDeComment(comment: string | undefined): number | null {
    if (!comment?.startsWith(PREFIJO_COMMENT_SERVICIO)) return null
    const id = Number(comment.slice(PREFIJO_COMMENT_SERVICIO.length))
    return Number.isInteger(id) && id > 0 ? id : null
}

export type TipoConexion = 'pppoe' | 'ip_estatica' | 'dhcp_fija'

/** Lo que el dispatcher sabe de un servicio (de `consultas.ts`). */
export interface ServicioRed {
    servicio_id: number
    estado: EstadoServicio
    tipo_conexion: TipoConexion
    router_id: number
    plan_id: number
    ipv4: string | null
    /** /64 y /56 vigentes (modo `estatico`/`duid`): van al `target` de la cola para limitar IPv6 */
    prefijos_v6: string[]
    mac: string | null
    amarre_ip_mac: boolean
    /** Velocidad efectiva del plan en el router (plantilla + excepciones) */
    velocidad: VelocidadPlan
}

/** Datos del router que entran en los objetos. */
export interface RouterRed {
    router_id: number
    /** `server` del lease (`all` si el router no define uno) */
    dhcp_servidor: string
    /** Interfaz del ARP estático; null = no se puede amarrar (se avisa) */
    interfaz_clientes: string | null
}

export interface PerfilSuspendidoRed {
    rateLimit: string
    addressList: string
}

export interface ObjetoDeseado {
    ruta: RutaServicio
    comment: string
    propiedades: Propiedades
}

export interface EstadoDeseado {
    servicio_id: number
    /** Objetos que deben existir */
    presentes: ObjetoDeseado[]
    /** Menús donde no debe haber nada con el comment del servicio */
    ausentes: RutaServicio[]
    avisos: string[]
}

/**
 * `Mikrotik-Rate-Limit` → propiedades de una cola simple. Mismo orden `rx/tx` = subida/bajada
 * del cliente que `max-limit` (target-upload/target-download). Campos que falten (un
 * `rate_limit_override` corto) quedan en 0 / prioridad 8, como los interpreta RouterOS.
 */
export function propiedadesCola(rateLimit: string): Propiedades {
    const [max = '0/0', rafaga = '0/0', umbral = '0/0', tiempo = '0/0', prioridad = '8', limitAt = '0/0'] =
        rateLimit.trim().split(/\s+/)
    const segundos = tiempo
        .split('/')
        .map((t) => (/^\d+$/.test(t) ? `${t}s` : t))
        .join('/')
    const dobles = (v: string) => (v.includes('/') ? v : `${v}/${v}`)
    return {
        'max-limit': dobles(max),
        'burst-limit': dobles(rafaga),
        'burst-threshold': dobles(umbral),
        'burst-time': dobles(segundos),
        priority: dobles(prioridad),
        'limit-at': dobles(limitAt),
    }
}

export function estadoVacio(servicioId: number): EstadoDeseado {
    return { servicio_id: servicioId, presentes: [], ausentes: [...RUTAS_SERVICIO], avisos: [] }
}

export function estadoDeseado(
    servicio: ServicioRed,
    router: RouterRed,
    suspendido: PerfilSuspendidoRed,
): EstadoDeseado {
    const id = servicio.servicio_id
    const vacio = estadoVacio(id)
    if (servicio.tipo_conexion === 'pppoe' || servicio.estado === 'retirado') return vacio
    if (!servicio.ipv4) return { ...vacio, avisos: ['el servicio no tiene IPv4 vigente'] }

    const comment = commentServicio(id)
    const presentes: ObjetoDeseado[] = []
    const avisos: string[] = []
    const rateLimit =
        servicio.estado === 'suspendido'
            ? suspendido.rateLimit
            : rateLimitServicio(servicio.velocidad, servicio.estado)

    presentes.push({
        ruta: '/queue/simple',
        comment,
        propiedades: {
            name: `argosisp-servicio-${id}`,
            target: [`${servicio.ipv4}/32`, ...servicio.prefijos_v6].join(','),
            ...propiedadesCola(rateLimit),
            disabled: 'no',
        },
    })
    if (servicio.estado === 'suspendido') {
        presentes.push({
            ruta: '/ip/firewall/address-list',
            comment,
            propiedades: { list: suspendido.addressList, address: servicio.ipv4, disabled: 'no' },
        })
    }
    if (servicio.tipo_conexion === 'dhcp_fija') {
        if (servicio.mac) {
            presentes.push({
                ruta: '/ip/dhcp-server/lease',
                comment,
                propiedades: {
                    address: servicio.ipv4,
                    'mac-address': servicio.mac.toUpperCase(),
                    server: router.dhcp_servidor,
                    disabled: 'no',
                },
            })
        } else {
            avisos.push('dhcp_fija sin mac: no se crea el lease')
        }
    }
    if (servicio.amarre_ip_mac && servicio.mac) {
        if (router.interfaz_clientes) {
            presentes.push({
                ruta: '/ip/arp',
                comment,
                propiedades: {
                    address: servicio.ipv4,
                    'mac-address': servicio.mac.toUpperCase(),
                    interface: router.interfaz_clientes,
                    disabled: 'no',
                },
            })
        } else {
            avisos.push('amarre IP-MAC sin interfaz de clientes en el router: no se crea el ARP')
        }
    }
    const conObjeto = new Set(presentes.map((o) => o.ruta))
    return {
        servicio_id: id,
        presentes,
        ausentes: RUTAS_SERVICIO.filter((r) => !conObjeto.has(r)),
        avisos,
    }
}
