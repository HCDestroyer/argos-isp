import type { ObjetoRouterOS, Propiedades } from '#network/routeros/cliente'

/**
 * Red de acceso en RouterOS (`contratos/red-acceso.md` §6, A2): funciones puras para el inventario
 * de solo lectura (descubrir), el estado deseado de las VLAN y servidores PPPoE `administrados`, su
 * deriva y el detector de conflictos de velocidad. La lectura y la escritura viven en
 * `inventario_acceso.ts` y `aplicar_red_acceso.ts`.
 *
 * Reglas que nunca se rompen:
 * - Solo se escribe lo que lleva `comment = argosisp:vlan:<id>`, `argosisp:pppoe:<id>` o
 *   `argosisp:perfil-pppoe:<id>`. Lo `adoptado` y lo ajeno nunca se tocan.
 * - `default` y `default-encrypted` nunca se tocan ni se usan como perfil de un servidor administrado.
 */

export const PREFIJO_VLAN = 'argosisp:vlan:'
export const PREFIJO_PPPOE = 'argosisp:pppoe:'
export const PREFIJO_PERFIL_PPPOE = 'argosisp:perfil-pppoe:'
export const PERFILES_DE_FABRICA = new Set(['default', 'default-encrypted'])

export const commentVlan = (id: number) => `${PREFIJO_VLAN}${id}`
export const commentServidor = (id: number) => `${PREFIJO_PPPOE}${id}`
export const commentPerfilServidor = (id: number) => `${PREFIJO_PERFIL_PPPOE}${id}`
/** `name` del perfil base de un servidor administrado (su `default-profile`). */
export const nombrePerfilServidor = (id: number) => `argosisp-pppoe-${id}`

/** `argosisp:<tipo>:<id>` → id, o null. */
export function idDeComment(comment: string | undefined, prefijo: string): number | null {
    if (!comment?.startsWith(prefijo)) return null
    const id = Number(comment.slice(prefijo.length))
    return Number.isInteger(id) && id > 0 ? id : null
}

/** ¿El objeto es de ArgosIsp (cualquier comment `argosisp:`)? */
export const esDeArgos = (o: ObjetoRouterOS) => (o.comment ?? '').startsWith('argosisp:')

// ---------------------------------------------------------------------------------------------
// Inventario (descubrir)
// ---------------------------------------------------------------------------------------------

/** De quién es un objeto del router según su comment. */
export interface MarcaArgos {
    /** Lleva un comment `argosisp:` */
    de_argos: boolean
    /** Entidad e id de Argos si el comment los trae (`argosisp:vlan:7` → `vlan`, 7) */
    entidad: 'vlan' | 'servidor_pppoe' | 'perfil_pppoe' | 'plan' | 'otro' | null
    id: number | null
}

export function marcaArgos(o: ObjetoRouterOS): MarcaArgos {
    const c = o.comment ?? ''
    if (!c.startsWith('argosisp:')) return { de_argos: false, entidad: null, id: null }
    const vlan = idDeComment(c, PREFIJO_VLAN)
    if (vlan) return { de_argos: true, entidad: 'vlan', id: vlan }
    const pppoe = idDeComment(c, PREFIJO_PPPOE)
    if (pppoe) return { de_argos: true, entidad: 'servidor_pppoe', id: pppoe }
    const perfil = idDeComment(c, PREFIJO_PERFIL_PPPOE)
    if (perfil) return { de_argos: true, entidad: 'perfil_pppoe', id: perfil }
    const plan = /^argosisp:plan:(\d+)/.exec(c)?.[1]
    if (plan) return { de_argos: true, entidad: 'plan', id: Number(plan) }
    return { de_argos: true, entidad: 'otro', id: null }
}

const si = (v: string | undefined) => v === 'true' || v === 'yes'
const entero = (v: string | undefined): number | null => {
    const n = Number(v)
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : null
}

export interface InterfazLeida {
    ros_id: string
    nombre: string
    tipo: string
    deshabilitada: boolean
    comentario: string | null
}

export interface VlanLeida {
    ros_id: string
    nombre: string
    vlan_id: number | null
    interfaz_padre: string
    mtu: number | null
    deshabilitada: boolean
    comentario: string | null
    argos: MarcaArgos
}

export interface ServidorLeido {
    ros_id: string
    service_name: string
    interfaz: string
    perfil: string
    max_mtu: number | null
    max_mru: number | null
    mrru: number | null
    autenticacion: string[]
    keepalive_timeout: number | null
    una_sesion_por_host: boolean
    max_sesiones: number | null
    deshabilitado: boolean
    comentario: string | null
    argos: MarcaArgos
}

export interface PerfilLeido {
    ros_id: string
    nombre: string
    local_address: string | null
    remote_address: string | null
    rate_limit: string | null
    de_fabrica: boolean
    comentario: string | null
    argos: MarcaArgos
}

export interface PoolLeido {
    ros_id: string
    nombre: string
    /** IPv4: `ranges` (`10.0.0.2-10.0.0.254,…`); IPv6: `prefix` */
    rangos: string
    /** IPv6: `prefix-length` */
    tamano_entrega: number | null
    comentario: string | null
}

/** Inventario de solo lectura de la red de acceso de un router (`DescubrimientoRedAcceso` de A1). */
export interface InventarioRedAcceso {
    router_id: number
    leido_en: string
    interfaces: InterfazLeida[]
    vlans: VlanLeida[]
    servidores_pppoe: ServidorLeido[]
    perfiles: PerfilLeido[]
    pools_ipv4: PoolLeido[]
    pools_ipv6: PoolLeido[]
}

/** Lo que se lee de cada menú (un GET por menú). */
export interface LecturaRedAcceso {
    interfaces: ObjetoRouterOS[]
    vlans: ObjetoRouterOS[]
    servidores: ObjetoRouterOS[]
    perfiles: ObjetoRouterOS[]
    pools_ipv4: ObjetoRouterOS[]
    pools_ipv6: ObjetoRouterOS[]
}

const texto = (v: string | undefined) => (v === undefined || v === '' ? null : v)

/** Arma el inventario a partir de lo leído (sin objetos dinámicos). */
export function inventarioDe(routerId: number, l: LecturaRedAcceso, leidoEn: Date): InventarioRedAcceso {
    const estaticos = (lista: ObjetoRouterOS[]) => lista.filter((o) => o.dynamic !== 'true')
    return {
        router_id: routerId,
        leido_en: leidoEn.toISOString(),
        interfaces: estaticos(l.interfaces).map((o) => ({
            ros_id: o['.id'],
            nombre: o.name ?? '',
            tipo: o.type ?? '',
            deshabilitada: si(o.disabled),
            comentario: texto(o.comment),
        })),
        vlans: estaticos(l.vlans).map((o) => ({
            ros_id: o['.id'],
            nombre: o.name ?? '',
            vlan_id: entero(o['vlan-id']),
            interfaz_padre: o.interface ?? '',
            mtu: entero(o.mtu),
            deshabilitada: si(o.disabled),
            comentario: texto(o.comment),
            argos: marcaArgos(o),
        })),
        servidores_pppoe: estaticos(l.servidores).map((o) => ({
            ros_id: o['.id'],
            service_name: o['service-name'] ?? '',
            interfaz: o.interface ?? '',
            perfil: o['default-profile'] ?? 'default',
            max_mtu: entero(o['max-mtu']),
            max_mru: entero(o['max-mru']),
            mrru: o.mrru === 'disabled' ? null : entero(o.mrru),
            autenticacion: (o.authentication ?? '').split(',').filter((a) => a !== ''),
            keepalive_timeout: entero(o['keepalive-timeout']),
            una_sesion_por_host: si(o['one-session-per-host']),
            max_sesiones: o['max-sessions'] === 'unlimited' ? null : entero(o['max-sessions']),
            deshabilitado: si(o.disabled),
            comentario: texto(o.comment),
            argos: marcaArgos(o),
        })),
        perfiles: estaticos(l.perfiles).map((o) => ({
            ros_id: o['.id'],
            nombre: o.name ?? '',
            local_address: texto(o['local-address']),
            remote_address: texto(o['remote-address']),
            rate_limit: texto(o['rate-limit']),
            de_fabrica: PERFILES_DE_FABRICA.has(o.name ?? ''),
            comentario: texto(o.comment),
            argos: marcaArgos(o),
        })),
        pools_ipv4: l.pools_ipv4.map((o) => ({
            ros_id: o['.id'],
            nombre: o.name ?? '',
            rangos: o.ranges ?? '',
            tamano_entrega: null,
            comentario: texto(o.comment),
        })),
        pools_ipv6: l.pools_ipv6.map((o) => ({
            ros_id: o['.id'],
            nombre: o.name ?? '',
            rangos: o.prefix ?? '',
            tamano_entrega: entero(o['prefix-length']),
            comentario: texto(o.comment),
        })),
    }
}

// ---------------------------------------------------------------------------------------------
// Estado deseado de lo administrado
// ---------------------------------------------------------------------------------------------

/** VLAN `administrada` de Argos (`network.vlans`). */
export interface VlanArgos {
    id: number
    nombre: string
    vlan_id: number
    interfaz_padre: string
    mtu: number | null
    estado: 'administrado' | 'adoptado'
    descripcion?: string | null
}

/** Servidor PPPoE de Argos (`network.servidores_pppoe`) con lo derivado que necesita RouterOS. */
export interface ServidorArgos {
    id: number
    nombre: string
    interfaz: string
    service_name: string
    estado: 'administrado' | 'adoptado'
    activo: boolean
    perfil_base: string
    max_mtu: number
    max_mru: number
    mrru: number | null
    autenticacion: string[]
    keepalive_timeout: number
    una_sesion_por_host: boolean
    max_sesiones: number | null
    /** Gateway de su red IPv4 (`localAddressServidor`); null = sin red o sin gateway */
    local_address: string | null
    /** Nombres de los pools en el router (los del servidor o, si no, los del plan) */
    pool_ipv4?: string | null
    pool_ipv6_enlace?: string | null
    pool_ipv6_delegacion?: string | null
}

/** Un objeto deseado en un menú de la red de acceso, identificado por su comment. */
export interface ObjetoAcceso {
    ruta: '/interface/vlan' | '/interface/pppoe-server/server' | '/ppp/profile'
    comment: string
    propiedades: Propiedades
    /** Propiedades que no deben quedar puestas (`unset`) */
    quitar?: string[]
}

/** Propiedades del perfil base que se copian al perfil del servidor: nunca direcciones ni velocidad. */
export const PROPIEDADES_PERFIL_SERVIDOR = [
    'dns-server',
    'wins-server',
    'change-tcp-mss',
    'use-compression',
    'use-encryption',
    'use-mpls',
    'use-upnp',
    'use-ipv6',
    'only-one',
    'idle-timeout',
    'session-timeout',
] as const

/**
 * Objetos deseados de la red de acceso (en orden de creación: VLAN → perfil del servidor →
 * servidor). Solo lo `administrado`; lo `adoptado` no genera nada (Argos nunca lo escribe).
 */
export function estadoRedAcceso(
    vlans: VlanArgos[],
    servidores: ServidorArgos[],
    perfiles: ObjetoRouterOS[],
): { presentes: ObjetoAcceso[]; avisos: string[] } {
    const presentes: ObjetoAcceso[] = []
    const avisos: string[] = []
    for (const v of [...vlans].sort((a, b) => a.id - b.id)) {
        if (v.estado !== 'administrado') continue
        presentes.push({
            ruta: '/interface/vlan',
            comment: commentVlan(v.id),
            propiedades: {
                name: v.nombre,
                'vlan-id': String(v.vlan_id),
                interface: v.interfaz_padre,
                ...(v.mtu ? { mtu: String(v.mtu) } : {}),
                disabled: 'no',
            },
        })
    }
    const porNombre = new Map(perfiles.map((p) => [p.name ?? '', p]))
    for (const s of [...servidores].sort((a, b) => a.id - b.id)) {
        if (s.estado !== 'administrado') continue
        const base = porNombre.get(s.perfil_base)
        const copia: Propiedades = {}
        if (base) {
            for (const k of PROPIEDADES_PERFIL_SERVIDOR) {
                const v = base[k]
                if (v !== undefined && v !== '') copia[k] = v
            }
        } else {
            avisos.push(`servidor PPPoE ${s.id}: no existe el perfil base «${s.perfil_base}» en el router`)
        }
        if (!s.local_address) {
            avisos.push(
                `servidor PPPoE ${s.id}: su red no tiene gateway; el perfil ${nombrePerfilServidor(s.id)} no lleva local-address`,
            )
        }
        presentes.push({
            ruta: '/ppp/profile',
            comment: commentPerfilServidor(s.id),
            propiedades: {
                ...copia,
                name: nombrePerfilServidor(s.id),
                ...(s.local_address ? { 'local-address': s.local_address } : {}),
                ...(s.pool_ipv4 ? { 'remote-address': s.pool_ipv4 } : {}),
                ...(s.pool_ipv6_enlace ? { 'remote-ipv6-prefix-pool': s.pool_ipv6_enlace } : {}),
                ...(s.pool_ipv6_delegacion ? { 'dhcpv6-pd-pool': s.pool_ipv6_delegacion } : {}),
            },
            quitar: s.local_address ? [] : ['local-address'],
        })
        presentes.push({
            ruta: '/interface/pppoe-server/server',
            comment: commentServidor(s.id),
            propiedades: {
                'service-name': s.service_name,
                interface: s.interfaz,
                'default-profile': nombrePerfilServidor(s.id),
                'max-mtu': String(s.max_mtu),
                'max-mru': String(s.max_mru),
                mrru: s.mrru === null ? 'disabled' : String(s.mrru),
                authentication: [...s.autenticacion].sort().join(','),
                'keepalive-timeout': String(s.keepalive_timeout),
                'one-session-per-host': s.una_sesion_por_host ? 'yes' : 'no',
                'max-sessions': s.max_sesiones === null ? 'unlimited' : String(s.max_sesiones),
                disabled: s.activo ? 'no' : 'yes',
            },
        })
    }
    return { presentes, avisos }
}

/** Menús con comment de la red de acceso, en orden de borrado (servidor → perfil → VLAN). */
export const MENUS_ACCESO = ['/interface/pppoe-server/server', '/ppp/profile', '/interface/vlan'] as const
export type MenuAcceso = (typeof MENUS_ACCESO)[number]

const PREFIJO_DE_MENU: Record<MenuAcceso, string> = {
    '/interface/pppoe-server/server': PREFIJO_PPPOE,
    '/ppp/profile': PREFIJO_PERFIL_PPPOE,
    '/interface/vlan': PREFIJO_VLAN,
}

/**
 * Sobrantes administrados: objetos con el comment de la red de acceso que ya no están en lo deseado
 * (borrados en Argos, pasados a adoptado). Nunca un objeto sin ese comment.
 */
export function sobrantesAcceso(
    presentes: ObjetoAcceso[],
    lectura: Map<MenuAcceso, ObjetoRouterOS[]>,
): Array<{ ruta: MenuAcceso; objeto: ObjetoRouterOS }> {
    const deseados = new Set(presentes.map((p) => `${p.ruta}|${p.comment}`))
    const salida: Array<{ ruta: MenuAcceso; objeto: ObjetoRouterOS }> = []
    for (const ruta of MENUS_ACCESO) {
        for (const o of lectura.get(ruta) ?? []) {
            if (o.dynamic === 'true') continue
            if (idDeComment(o.comment, PREFIJO_DE_MENU[ruta]) === null) continue
            if (ruta === '/ppp/profile' && PERFILES_DE_FABRICA.has(o.name ?? '')) continue
            if (!deseados.has(`${ruta}|${o.comment}`)) salida.push({ ruta, objeto: o })
        }
    }
    return salida
}

// ---------------------------------------------------------------------------------------------
// Detector de conflictos (vista previa)
// ---------------------------------------------------------------------------------------------

export type CodigoConflicto =
    | 'radius_y_colas_api'
    | 'arbol_y_simples'
    | 'perfil_con_rate_limit_y_colas'
    | 'perfil_de_fabrica_con_rate_limit'

export interface Conflicto {
    codigo: CodigoConflicto
    mensaje: string
    /** Objetos del router implicados (`menú name`), hasta 20 */
    objetos: string[]
}

/** Lo que mira el detector: colas y perfiles del router y cómo limita la estrategia. */
export interface EntradaConflictos {
    /** La estrategia PPPoE del router limita por RADIUS (`radius_rate_limit` o `perfil_ppp` con RADIUS) */
    pppoe_por_radius: boolean
    /** Alguna estrategia del router usa el árbol (`arbol_pcq`) */
    usa_arbol: boolean
    /** Alguna estrategia usa colas simples estáticas (`cola_simple`, `pcq_plan`, padres) */
    usa_simples: boolean
    colas_simples: ObjetoRouterOS[]
    arbol: ObjetoRouterOS[]
    perfiles: ObjetoRouterOS[]
}

const muestra = (xs: string[]) => xs.slice(0, 20)

/**
 * Conflictos de control de velocidad que se crearían o ya existen en el router (antes de aplicar):
 *
 * | Código | Cuándo |
 * | --- | --- |
 * | `radius_y_colas_api` | PPPoE limitado por RADIUS y colas simples estáticas ajenas cuyo `target` es de una sesión `<pppoe-…>` o un `/32`: doble limitación (RADIUS crea la dinámica y la estática compite) |
 * | `arbol_y_simples` | Árbol (`arbol_pcq`) y colas simples estáticas ajenas: las simples se procesan antes y el árbol no ve el tráfico |
 * | `perfil_con_rate_limit_y_colas` | Un perfil PPP con `rate-limit` (ajeno o de fábrica) y colas simples estáticas ajenas: dos limitadores por cliente |
 * | `perfil_de_fabrica_con_rate_limit` | `default`/`default-encrypted` con `rate-limit` en un router cuyo PPPoE se limita por Argos: lo que llegue sin grupo hereda ese límite |
 *
 * Solo informa: nunca borra lo ajeno.
 */
export function detectarConflictos(e: EntradaConflictos): Conflicto[] {
    const conflictos: Conflicto[] = []
    const ajenasSimples = e.colas_simples.filter((o) => o.dynamic !== 'true' && !esDeArgos(o))
    const ajenoArbol = e.arbol.filter((o) => o.dynamic !== 'true' && !esDeArgos(o))
    const nombres = (xs: ObjetoRouterOS[], menu: string) =>
        muestra(xs.map((o) => `${menu} ${o.name ?? o['.id']}`))

    if (e.pppoe_por_radius) {
        const deClientes = ajenasSimples.filter((o) =>
            (o.target ?? '').split(',').some((t) => t.startsWith('<pppoe-') || t.endsWith('/32')),
        )
        if (deClientes.length > 0) {
            conflictos.push({
                codigo: 'radius_y_colas_api',
                mensaje:
                    `${deClientes.length} colas simples estáticas ajenas limitan clientes que RADIUS ya limita ` +
                    '(Mikrotik-Rate-Limit crea su cola dinámica): doble limitación. Quítalas o cambia el modo',
                objetos: nombres(deClientes, '/queue/simple'),
            })
        }
    }
    if (e.usa_arbol && ajenasSimples.length > 0) {
        conflictos.push({
            codigo: 'arbol_y_simples',
            mensaje:
                `el árbol (queue tree) no verá el tráfico que ya tomen ${ajenasSimples.length} colas simples ` +
                'estáticas ajenas: se procesan antes. Quítalas o usa colas simples',
            objetos: nombres(ajenasSimples, '/queue/simple'),
        })
    }
    if (e.usa_simples && ajenoArbol.length > 0) {
        conflictos.push({
            codigo: 'arbol_y_simples',
            mensaje: `${ajenoArbol.length} nodos de queue tree ajenos conviven con las colas simples de Argos`,
            objetos: nombres(ajenoArbol, '/queue/tree'),
        })
    }
    const perfilesConRate = e.perfiles.filter((p) => !esDeArgos(p) && (p['rate-limit'] ?? '') !== '')
    const ajenosConRate = perfilesConRate.filter((p) => !PERFILES_DE_FABRICA.has(p.name ?? ''))
    if (ajenosConRate.length > 0 && ajenasSimples.length > 0) {
        conflictos.push({
            codigo: 'perfil_con_rate_limit_y_colas',
            mensaje:
                `${ajenosConRate.length} perfiles PPP ajenos con rate-limit y ${ajenasSimples.length} colas simples ` +
                'estáticas: dos limitadores por cliente',
            objetos: muestra([
                ...nombres(ajenosConRate, '/ppp/profile'),
                ...nombres(ajenasSimples, '/queue/simple'),
            ]),
        })
    }
    const fabrica = perfilesConRate.filter((p) => PERFILES_DE_FABRICA.has(p.name ?? ''))
    if (fabrica.length > 0) {
        conflictos.push({
            codigo: 'perfil_de_fabrica_con_rate_limit',
            mensaje:
                `el perfil ${fabrica.map((p) => p.name).join(', ')} tiene rate-limit: una sesión sin grupo de Argos ` +
                'hereda ese límite. Argos no toca ese perfil: quítalo a mano',
            objetos: nombres(fabrica, '/ppp/profile'),
        })
    }
    return conflictos
}

// ---------------------------------------------------------------------------------------------
// Perfiles por servidor (RADIUS)
// ---------------------------------------------------------------------------------------------

/**
 * Decisión (A2, 5 nov): con RADIUS, el `local-address` vive en el **perfil del servidor**
 * (`argosisp-pppoe-<srv>`, su `default-profile`), un objeto por servidor. El perfil `plan-<id>` solo
 * existe cuando la estrategia lo pide (padre, tipo de cola o `perfil_ppp`) y entonces manda sobre el
 * del servidor (`Mikrotik-Group`). Solo si el router tiene servidores con **gateways distintos** y el
 * plan necesita perfil, se crea `plan-<id>-s<srv>` para cada servidor por el que el plan tiene
 * servicios (copia de `plan-<id>` con el `local-address` del servidor) y `aaa` manda ese grupo.
 *
 * Así: un router con un gateway (lo común) no cambia nada; `radius_rate_limit` sin padre no crea
 * ningún perfil de plan; y nunca se duplican colas: las variantes cuelgan del mismo
 * `argosisp-plan-<id>` (o del router) y solo difieren en `local-address`.
 */
export interface ServidorGateway {
    id: number
    local_address: string | null
}

/** ¿El router necesita perfiles de plan por servidor? (≥ 2 gateways distintos en servidores activos) */
export function perfilesPorServidor(servidores: ServidorGateway[]): boolean {
    return new Set(servidores.map((s) => s.local_address).filter((g): g is string => g !== null)).size > 1
}

/** `plan-<id>-s<srv>`: perfil del plan para un servidor (solo con `perfilesPorServidor`). */
export function nombrePerfilPlanServidor(planId: number, servidorId: number): string {
    return `plan-${planId}-s${servidorId}`
}

export function commentPerfilPlanServidor(planId: number, servidorId: number): string {
    return `argosisp:plan:${planId}:s${servidorId}`
}

/**
 * `Mikrotik-Group` que debe mandar `aaa` a un servicio activo: null si el plan no necesita perfil (el
 * servidor da el `local-address` con su `default-profile`), `plan-<id>-s<srv>` con perfiles por
 * servidor, o `plan-<id>`. La usa A1 al armar `aaa:user:*` (`red_acceso.servidor_pppoe_id`).
 */
export function grupoPerfilPlan(
    planId: number,
    necesitaPerfil: boolean,
    servidorId: number | null,
    porServidor: boolean,
): string | null {
    if (!necesitaPerfil) return null
    if (porServidor && servidorId !== null) return nombrePerfilPlanServidor(planId, servidorId)
    return `plan-${planId}`
}
