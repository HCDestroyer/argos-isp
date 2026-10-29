import type { EstadoServicioConPendiente } from '#shared/eventos'
import { rateLimitServicio, type ControlVelocidad, type VelocidadPlan } from '#network/velocidad'
import {
    nombreTipoHoja,
    padreCliente,
    velocidadConExtras,
    type Estrategia,
} from '#network/estrategia_velocidad'
import { listaPlan } from '#network/routeros/velocidad_router'
import type { Propiedades, RutaRouterOS } from '#network/routeros/cliente'

/**
 * Estado deseado en el router de un servicio sin PPPoE (`contratos/routeros.md`). Función pura:
 * con los datos vigentes del servicio dice qué objetos deben existir (y con qué propiedades) y
 * cuáles no, todos identificados por `comment = argosisp:servicio:<id>`. El dispatcher lo aplica
 * con `asegurar`/`borrar`, así que un evento repetido o fuera de orden no deja basura.
 *
 * | Objeto | Cuándo |
 * | --- | --- |
 * | Cola simple (`/queue/simple`) | Modo `simple`: siempre (rate-limit de `rateLimitServicio`, `parent` al padre del plan con reuso). `arbol_pcq`: solo suspendido |
 * | Address-list `suspendidos` | Solo en `suspendido` (mismo NAT a `/corte` que PPPoE) |
 * | Address-list `argosisp-plan-<id>[-limitado]` (IPv4 e IPv6) | `arbol_pcq`, activo o limitado: IPv4 y prefijo delegado (WISP) o las direcciones de la sesión abierta (PPPoE: IPv4, /64, /56) |
 * | Lease DHCP | Solo en `dhcp_fija` (también suspendido: necesita su IP para llegar a `/corte`) |
 * | ARP estático | Solo con `amarre_ip_mac` y `mac` |
 *
 * Un servicio `retirado`, `pendiente_instalacion` (`contratos/instalacion.md` §3: nada hasta que se
 * activa, con `servicio.estado_cambiado` y `motivo: instalacion`), inexistente o sin IPv4 no tiene
 * nada en el router; uno `pppoe`, solo sus entradas del árbol.
 */

/** Menús donde un servicio puede tener objetos (en este orden se aplican). */
export const RUTAS_SERVICIO = [
    '/queue/simple',
    '/ip/firewall/address-list',
    '/ipv6/firewall/address-list',
    '/ip/dhcp-server/lease',
    '/ip/arp',
] as const satisfies readonly RutaRouterOS[]

/**
 * Entradas IPv6 de un servicio en las listas del árbol (`arbol_pcq`): una por prefijo, con
 * `comment = argosisp:servicio:<id>:<sufijo>` (el cliente deja un solo objeto por comment).
 */
export const SUFIJOS_V6 = ['enlace', 'delegado', 'delegado-2'] as const
export type SufijoV6 = (typeof SUFIJOS_V6)[number]

export function commentServicioV6(servicioId: number, sufijo: SufijoV6): string {
    return `${commentServicio(servicioId)}:${sufijo}`
}

/** Todos los (menú, comment) que puede tener un servicio: lo que se borra si no debe estar. */
function clavesServicio(servicioId: number): Array<{ ruta: RutaServicio; comment: string }> {
    return RUTAS_SERVICIO.flatMap((ruta): Array<{ ruta: RutaServicio; comment: string }> =>
        ruta === '/ipv6/firewall/address-list'
            ? SUFIJOS_V6.map((sufijo) => ({ ruta, comment: commentServicioV6(servicioId, sufijo) }))
            : [{ ruta, comment: commentServicio(servicioId) }],
    )
}
export type RutaServicio = (typeof RUTAS_SERVICIO)[number]

export const PREFIJO_COMMENT_SERVICIO = 'argosisp:servicio:'

export function commentServicio(servicioId: number): string {
    return `${PREFIJO_COMMENT_SERVICIO}${servicioId}`
}

/** `argosisp:servicio:<id>` (o `argosisp:servicio:<id>:<sufijo>`) → id; null si no es de un servicio. */
export function servicioDeComment(comment: string | undefined): number | null {
    if (!comment?.startsWith(PREFIJO_COMMENT_SERVICIO)) return null
    const id = Number(comment.slice(PREFIJO_COMMENT_SERVICIO.length).split(':')[0])
    return Number.isInteger(id) && id > 0 ? id : null
}

export type TipoConexion = 'pppoe' | 'ip_estatica' | 'dhcp_fija'

/** Lo que el dispatcher sabe de un servicio (de `consultas.ts`). */
export interface ServicioRed {
    servicio_id: number
    estado: EstadoServicioConPendiente
    tipo_conexion: TipoConexion
    router_id: number
    plan_id: number
    ipv4: string | null
    /**
     * Prefijo delegado vigente (/56 por DUID o estático): va al `target` de la cola para limitar IPv6.
     * Nunca el /64 de enlace: en WISP es el del segmento, compartido entre clientes.
     */
    prefijos_v6: string[]
    mac: string | null
    amarre_ip_mac: boolean
    /** Sesión PPPoE abierta (la más reciente): sus direcciones van a las listas del árbol */
    sesion?: { ipv4: string | null; enlace: string | null; delegado: string | null } | null
    /** Velocidad efectiva del plan en el router (plantilla + excepciones) */
    velocidad: VelocidadPlan
    /** Estrategia efectiva vigente para su tipo de conexión (`contratos/control-velocidad.md`) */
    estrategia: Estrategia
    /** Estrategia PPPoE del plan en el router (decide el perfil `plan-<id>`, aunque el servicio sea WISP) */
    estrategia_pppoe: Estrategia
    /**
     * PPPoE con sesión abierta: la estrategia vigente cuando conectó (la anterior si conectó antes del
     * último cambio; la conserva hasta reconectar). null sin sesión o fuera de PPPoE.
     */
    estrategia_sesion: Estrategia | null
}

/** Datos del router que entran en los objetos. */
export interface RouterRed {
    router_id: number
    /** `server` del lease (`all` si el router no define uno) */
    dhcp_servidor: string
    /** Interfaz del ARP estático; null = no se puede amarrar (se avisa) */
    interfaz_clientes: string | null
    /** `network.routers.control_velocidad` (`contratos/velocidad.md`) */
    control_velocidad: ControlVelocidad
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
    /** (menú, comment) del servicio que no deben existir */
    ausentes: Array<{ ruta: RutaServicio; comment: string }>
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
    return { servicio_id: servicioId, presentes: [], ausentes: clavesServicio(servicioId), avisos: [] }
}

function completar(id: number, presentes: ObjetoDeseado[], avisos: string[]): EstadoDeseado {
    const conObjeto = new Set(presentes.map((o) => `${o.ruta}|${o.comment}`))
    return {
        servicio_id: id,
        presentes,
        ausentes: clavesServicio(id).filter((c) => !conObjeto.has(`${c.ruta}|${c.comment}`)),
        avisos,
    }
}

/**
 * Entradas de las listas del plan en `arbol_pcq` (IPv4 y cada prefijo IPv6) de un servicio activo
 * o limitado: el mangle del plan las marca y el árbol las limita.
 */
function entradasArbol(
    id: number,
    planId: number,
    limitado: boolean,
    ipv4: string | null,
    v6: Array<[SufijoV6, string]>,
): ObjetoDeseado[] {
    const list = listaPlan(planId, limitado)
    const salida: ObjetoDeseado[] = []
    if (ipv4) {
        salida.push({
            ruta: '/ip/firewall/address-list',
            comment: commentServicio(id),
            propiedades: { list, address: ipv4, disabled: 'no' },
        })
    }
    for (const [sufijo, prefijo] of v6) {
        salida.push({
            ruta: '/ipv6/firewall/address-list',
            comment: commentServicioV6(id, sufijo),
            propiedades: { list, address: prefijo, disabled: 'no' },
        })
    }
    return salida
}

export function estadoDeseado(
    servicio: ServicioRed,
    router: RouterRed,
    suspendido: PerfilSuspendidoRed,
): EstadoDeseado {
    const id = servicio.servicio_id
    const vacio = estadoVacio(id)
    const cuenta = servicio.estado === 'activo' || servicio.estado === 'limitado'
    if (servicio.estado === 'retirado' || servicio.estado === 'pendiente_instalacion') return vacio
    // Estrategia con la que está limitado: la de su sesión PPPoE (la anterior si conectó antes del cambio).
    const e =
        servicio.tipo_conexion === 'pppoe' && servicio.estrategia_sesion
            ? servicio.estrategia_sesion
            : servicio.estrategia
    const arbol = e.aplicacion === 'arbol_pcq'
    if (servicio.tipo_conexion === 'pppoe') {
        // PPPoE: la cola y el corte vienen de RADIUS. En el árbol, sus direcciones (de la sesión
        // abierta) van a la lista del plan; sin sesión, nada. En `pcq_plan` van al `target` de la
        // cola del plan (objeto del router, `velocidad_router.ts`).
        if (!arbol || !cuenta || !servicio.sesion) return vacio
        const v6: Array<[SufijoV6, string]> = []
        if (servicio.sesion.enlace) v6.push(['enlace', servicio.sesion.enlace])
        if (servicio.sesion.delegado) v6.push(['delegado', servicio.sesion.delegado])
        return completar(
            id,
            entradasArbol(id, servicio.plan_id, servicio.estado === 'limitado', servicio.sesion.ipv4, v6),
            [],
        )
    }
    if (!servicio.ipv4) return { ...vacio, avisos: ['el servicio no tiene IPv4 vigente'] }

    const comment = commentServicio(id)
    const presentes: ObjetoDeseado[] = []
    const avisos: string[] = []
    const velocidad = velocidadConExtras(servicio.velocidad, e.extras)
    const rateLimit =
        servicio.estado === 'suspendido'
            ? suspendido.rateLimit
            : rateLimitServicio(velocidad, servicio.estado)
    const colaPropia = e.aplicacion === 'cola_simple'
    const tipoHoja = colaPropia ? nombreTipoHoja(e.tipo_cola) : null

    // Cola por servicio solo en `cola_simple`; en el árbol y en `pcq_plan`, solo el suspendido (como
    // la dinámica del PPPoE suspendido, que `aaa` crea con el rate-limit mínimo).
    if (colaPropia || servicio.estado === 'suspendido') {
        presentes.push({
            ruta: '/queue/simple',
            comment,
            propiedades: {
                name: `argosisp-servicio-${id}`,
                target: [`${servicio.ipv4}/32`, ...servicio.prefijos_v6].join(','),
                ...propiedadesCola(rateLimit),
                ...(tipoHoja ? { queue: `${tipoHoja}/${tipoHoja}` } : {}),
                // Hija del padre del plan o del router (`velocidad_router.ts`). Un suspendido no cuenta
                // para el padre ni cuelga de él (igual que PPPoE con `suspendido`).
                parent: cuenta && colaPropia ? padreCliente(e, servicio.plan_id, velocidad.reuso) : 'none',
                disabled: 'no',
            },
        })
    }
    if (servicio.estado === 'suspendido') {
        presentes.push({
            ruta: '/ip/firewall/address-list',
            comment,
            propiedades: { list: suspendido.addressList, address: servicio.ipv4, disabled: 'no' },
        })
    } else if (arbol) {
        // WISP: solo el prefijo delegado propio (el /64 del segmento es compartido).
        const sufijos: SufijoV6[] = ['delegado', 'delegado-2']
        const v6 = servicio.prefijos_v6
            .slice(0, sufijos.length)
            .map((p, i): [SufijoV6, string] => [sufijos[i]!, p])
        presentes.push(
            ...entradasArbol(id, servicio.plan_id, servicio.estado === 'limitado', servicio.ipv4, v6),
        )
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
    return completar(id, presentes, avisos)
}
