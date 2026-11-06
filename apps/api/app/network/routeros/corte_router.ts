import { lookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'
import type { ObjetoRouterOS, Propiedades, RutaOrdenada, RutaRouterOS } from '#network/routeros/cliente'
import { PERFIL_PPP_BASE, PROPIEDADES_PERFIL_BASE } from '#network/routeros/velocidad_router'

/**
 * Objetos de nivel router que no dependen de la estrategia de velocidad (`contratos/control-velocidad.md`
 * §10): el corte de los suspendidos, siempre, y la excepción de FastTrack cuando alguna estrategia la pide.
 * Función pura: con la configuración de corte y lo leído del router, qué debe existir y en qué orden.
 *
 * Usa **los mismos comentarios y propiedades** que `infra/mikrotik/lab.rsc` y el script de conexión con
 * `incluir=servicio` (`argosisp: corte …`, `argosisp:top …`): si el router ya tiene lo que dejó el
 * script, el reconciliador no cambia nada, y si corre primero, el script lo reemplaza por lo mismo.
 *
 * | Menú | Qué | Clave |
 * | --- | --- | --- |
 * | `/interface/list` | `suspendidos` (las interfaces PPP del perfil suspendido) | `name` |
 * | `/ppp/profile` | `suspendido`: rate-limit mínimo, `address-list` e `interface-list` | `name` |
 * | `/ip(v6)/firewall/address-list` | `argos-portal`, `argos-dns`, `argos-walled`, `argos-clientes`, `suspendidos` | `list` + `address` |
 * | `/ip(v6)/firewall/filter` | saltos `argosisp:top` (corte, Filter-Id, sin FastTrack) y cadenas `argos-corte`, `argos-corte-in`, `argos-activo` | `comment` |
 * | `/ip(v6)/firewall/nat` | saltos `argosisp:top` y cadena `argos-corte-nat` (HTTP → `/corte` del portal; IPv6 solo con `portal_v6`) | `comment` |
 *
 * Solo se toca lo que lleva esos comentarios. Las entradas de address-list solo se administran si la
 * configuración las define (si falta, lo que haya puesto el script queda como está).
 */

/** Configuración del corte: la misma que usa el script de conexión (`ROUTERS_SERVICIO_*`). */
export interface ConfigCorte {
    /**
     * IPv4 del portal para el `to-addresses` del dst-nat HTTP → `/corte` y para `argos-portal`. Con el
     * portal por nombre (FQDN), `configCorteResuelta` la resuelve en cada reconciliación: vive solo en
     * el estado deseado, nunca se guarda ni se cachea.
     */
    portal_v4: string | null
    /** De dónde salió `portal_v4`: la variable, la IP de `PORTAL_URL_PUBLICA` o el DNS del FQDN */
    portal_v4_origen: 'variable' | 'url' | 'dns' | null
    /** El FQDN del portal no resolvió a IPv4: por qué (y qué hacer) */
    portal_v4_error: string | null
    portal_v6: string | null
    portal_fqdn: string | null
    portal_puerto: number
    /** `PORTAL_URL_PUBLICA` (la que ve el cliente; solo informativa en el diagnóstico) */
    portal_url: string | null
    /** Destino real del dst-nat: `http://<portal_v4>:<puerto>/corte`; null sin IPv4 del portal */
    nat_url: string | null
    walled_garden: string[]
    dns_v4: string[]
    dns_v6: string[]
    /** Dirección del router en los enlaces PPP (DNS para los clientes) */
    ppp_local_v4: string | null
    clientes_v4: string[]
    clientes_v6: string[]
    susp_rate_limit: string
    /** Lista y perfil del suspendido (los mismos de `aaa`) */
    address_list: string
    perfil: string
}

const separar = (v: string | undefined | null) =>
    (v ?? '')
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter((x) => x !== '')

function hostDe(url: string | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url).hostname.replace(/^\[|\]$/g, '')
    } catch {
        return null
    }
}

/**
 * Configuración del corte desde el entorno de la API: `ROUTERS_SERVICIO_<NOMBRE>` (las mismas variables
 * del script de conexión de A1), con lo que se pueda deducir de la configuración de Argos:
 * - el portal (FQDN o IP) de `PORTAL_URL_PUBLICA`;
 * - el walled garden de la pasarela (`PASARELA_URL_PUBLICA`, o `app.recurrente.com` con Recurrente).
 */
export function configCorte(entorno: NodeJS.ProcessEnv = process.env): ConfigCorte {
    const leer = (nombre: string) => entorno[`ROUTERS_SERVICIO_${nombre}`]?.trim() || null
    const hostPortal = hostDe(entorno.PORTAL_URL_PUBLICA)
    const walled = separar(leer('WALLED_GARDEN'))
    if (walled.length === 0) {
        const pasarela = hostDe(entorno.PASARELA_URL_PUBLICA)
        if (pasarela && !isIPv4(pasarela) && !isIPv6(pasarela)) walled.push(pasarela)
        if (entorno.PASARELA_PROVEEDOR === 'recurrente') walled.push('app.recurrente.com')
    }
    const variableV4 = leer('PORTAL_V4')
    const portalV4 = variableV4 ?? (hostPortal && isIPv4(hostPortal) ? hostPortal : null)
    const portalFqdn =
        leer('PORTAL_FQDN') ?? (hostPortal && !isIPv4(hostPortal) && !isIPv6(hostPortal) ? hostPortal : null)
    const leido = Number(leer('PORTAL_PUERTO') ?? 80)
    const puerto = Number.isInteger(leido) && leido > 0 && leido < 65536 ? leido : 80
    return {
        portal_v4: portalV4,
        portal_v4_origen: variableV4 ? 'variable' : portalV4 ? 'url' : null,
        portal_v4_error: null,
        portal_v6: leer('PORTAL_V6') ?? (hostPortal && isIPv6(hostPortal) ? hostPortal : null),
        portal_fqdn: portalFqdn,
        portal_puerto: puerto,
        portal_url: entorno.PORTAL_URL_PUBLICA?.trim() || null,
        nat_url: portalV4 ? urlNat(portalV4, puerto) : null,
        walled_garden: [...new Set(walled)],
        dns_v4: separar(leer('DNS_V4')),
        dns_v6: separar(leer('DNS_V6')),
        ppp_local_v4: leer('PPP_LOCAL_V4'),
        clientes_v4: separar(leer('CLIENTES_V4')),
        clientes_v6: separar(leer('CLIENTES_V6')),
        susp_rate_limit:
            leer('SUSP_RATE_LIMIT') ?? entorno.ROUTEROS_SUSPENDIDO_RATE_LIMIT?.trim() ?? '256k/256k',
        address_list: entorno.ROUTEROS_SUSPENDIDO_ADDRESS_LIST?.trim() || 'suspendidos',
        perfil: entorno.AAA_SUSPENDIDO_GRUPO?.trim() || 'suspendido',
    }
}

/** `http://<ip>:<puerto>/corte`: lo que el dst-nat manda al portal (y lo que prueba `/tool/fetch`). */
export function urlNat(ip: string, puerto: number): string {
    return `http://${ip}:${puerto}/corte`
}

/** Resuelve un nombre a sus IPv4 (el DNS del servidor de Argos). Inyectable en pruebas. */
export type ResolverIPv4 = (host: string) => Promise<string[]>

const ESPERA_DNS_MS = 3000

/** `getaddrinfo` (respeta `/etc/hosts` y el DNS de Docker), solo IPv4, con espera máxima de 3 s. */
export const resolverIPv4: ResolverIPv4 = async (host) => {
    let reloj: NodeJS.Timeout | undefined
    const espera = new Promise<never>((_, rechazar) => {
        reloj = setTimeout(
            () => rechazar(Object.assign(new Error('sin respuesta del DNS'), { code: 'ETIMEOUT' })),
            ESPERA_DNS_MS,
        )
    })
    try {
        const direcciones = await Promise.race([lookup(host, { family: 4, all: true }), espera])
        return direcciones.map((d) => d.address)
    } finally {
        clearTimeout(reloj)
    }
}

/**
 * `configCorte` con la IPv4 del portal resuelta cuando el portal es un nombre (lo normal: `PORTAL_URL_PUBLICA`
 * con FQDN y sin `ROUTERS_SERVICIO_PORTAL_V4`). Se llama en cada reconciliación y en cada diagnóstico:
 * la IP resuelta solo entra en el estado deseado (`to-addresses` del dst-nat y `argos-portal`), nunca se
 * guarda, y si el DNS cambia la siguiente pasada corrige el router. Si no resuelve, `portal_v4` queda
 * null y `portal_v4_error` dice por qué: el reconciliador emite `routeros.fallido` y conserva la regla
 * que haya, y el diagnóstico de corte sale en rojo.
 */
export async function configCorteResuelta(
    entorno: NodeJS.ProcessEnv = process.env,
    resolver: ResolverIPv4 = resolverIPv4,
): Promise<ConfigCorte> {
    const config = configCorte(entorno)
    if (config.portal_v4 || !config.portal_fqdn) return config
    const fqdn = config.portal_fqdn
    let ips: string[] = []
    let causa = 'no tiene registro A'
    try {
        const resueltas = await resolver(fqdn)
        ips = resueltas.filter((ip) => isIPv4(ip))
    } catch (error) {
        const e = error as Error & { code?: string }
        causa = e.code === 'ENOTFOUND' ? 'el nombre no existe' : (e.code ?? e.message)
    }
    if (ips.length === 0) {
        return {
            ...config,
            portal_v4_error:
                `No se pudo resolver ${fqdn} a IPv4 desde el servidor de Argos (${causa}): sin esa IP no se ` +
                'escribe el NAT de HTTP a /corte y el suspendido no ve la página de corte. Arregla el DNS del ' +
                'servidor o fija la IP con ROUTERS_SERVICIO_PORTAL_V4=<IPv4 del portal> y usa «Reconciliar ahora»',
        }
    }
    const ip = ips[0]!
    return { ...config, portal_v4: ip, portal_v4_origen: 'dns', nat_url: urlNat(ip, config.portal_puerto) }
}

/** Una regla de filtro o NAT (clave `comment`). */
export interface ReglaCorte {
    ruta: RutaOrdenada
    comment: string
    propiedades: Propiedades
    /** `argosisp:top`: va al inicio de su tabla, antes de FastTrack y de `accept established,related` */
    arriba: boolean
}

/** Una entrada de address-list (clave `list` + `address`). */
export interface EntradaListaCorte {
    ruta: '/ip/firewall/address-list' | '/ipv6/firewall/address-list'
    list: string
    address: string
    comment: string
}

/** Grupo de entradas que el reconciliador administra (si la configuración lo define). */
export interface GrupoListaCorte {
    ruta: EntradaListaCorte['ruta']
    list: string
    comment: string
}

export interface EstadoCorte {
    /** `/interface/list` y `/ppp/profile` por `name` */
    nombrados: Array<{ ruta: RutaRouterOS; name: string; propiedades: Propiedades }>
    entradas: EntradaListaCorte[]
    /** Grupos de entradas administrados: lo que sobre en ellos se borra */
    grupos: GrupoListaCorte[]
    /** Reglas en orden: primero las de arriba, después las cadenas (cada tabla por separado) */
    reglas: ReglaCorte[]
    /** Comentarios de reglas que ArgosIsp administra en cada tabla (lo que sobre se borra) */
    propias: Map<RutaOrdenada, Set<string>>
    /** Reglas que no se pueden armar por falta de configuración: se dejan como estén */
    conservar: Set<string>
    avisos: string[]
}

export interface OpcionesCorte {
    /** Alguna estrategia del router pide excluir de FastTrack a los clientes con colas */
    fasttrack: boolean
    /** Redes IPv4 de clientes del router (`network.redes_ipv4`), para `argos-clientes` */
    redes_v4: string[]
    /**
     * `local-address` del perfil de corte: el único gateway de las redes del router
     * (`localAddressCorte`). null/ausente = no se pone (nunca se copia el de `default`; uno que ya
     * tenga el perfil se respeta: lo puede haber puesto `lab.rsc`).
     */
    local_address?: string | null
    /** Gateways efectivos de las redes del router (sin repetir): van a `argos-dns` (DNS del router) */
    gateways_v4?: string[]
}

/** Dirección de documentación (RFC 5737) que deja creada la lista de suspendidos. */
export const ENTRADA_SUSPENDIDOS = '192.0.2.255'

/** Comentario del dst-nat HTTP → `/corte` (el mismo de `lab.rsc` y del script de conexión). */
export const REGLA_NAT_HTTP = 'argosisp: corte-nat HTTP a /corte'

/** DNS del suspendido hacia cualquier resolver (IPv4 e IPv6). */
export const REGLA_DNS_UDP = 'argosisp: corte DNS udp a cualquier resolver'
export const REGLA_DNS_TCP = 'argosisp: corte DNS tcp a cualquier resolver'

/**
 * Reglas que ArgosIsp escribía antes y ya no van: llevan comment `argosisp:` y el reconciliador las
 * borra de los routers existentes. `corte DNS udp/tcp` solo aceptaba DNS hacia `argos-dns`.
 */
export const REGLAS_RETIRADAS = ['argosisp: corte DNS udp', 'argosisp: corte DNS tcp'] as const

const FILTRO = '/ip/firewall/filter'
const FILTRO6 = '/ipv6/firewall/filter'
const NAT = '/ip/firewall/nat'
const NAT6 = '/ipv6/firewall/nat'

function reglasFiltro(ruta: typeof FILTRO | typeof FILTRO6, lista: string, fasttrack: boolean): ReglaCorte[] {
    const r = (comment: string, propiedades: Propiedades, arriba = false): ReglaCorte => ({
        ruta,
        comment,
        propiedades: { ...propiedades, disabled: 'no' },
        arriba,
    })
    const v6 = ruta === FILTRO6
    const salida: ReglaCorte[] = [
        r(
            'argosisp:top corte input por address-list',
            { chain: 'input', 'src-address-list': lista, action: 'jump', 'jump-target': 'argos-corte-in' },
            true,
        ),
        r(
            'argosisp:top corte input por interface-list',
            { chain: 'input', 'in-interface-list': lista, action: 'jump', 'jump-target': 'argos-corte-in' },
            true,
        ),
        r(
            'argosisp:top corte por address-list',
            { chain: 'forward', 'src-address-list': lista, action: 'jump', 'jump-target': 'argos-corte' },
            true,
        ),
        r(
            'argosisp:top corte por interface-list',
            { chain: 'forward', 'in-interface-list': lista, action: 'jump', 'jump-target': 'argos-corte' },
            true,
        ),
        r(
            'argosisp:top Filter-Id de RADIUS/CoA',
            { chain: 'forward', action: 'jump', 'jump-target': 'ppp' },
            true,
        ),
    ]
    if (fasttrack) {
        for (const [sentido, campo] of [
            ['subida', 'src-address-list'],
            ['bajada', 'dst-address-list'],
        ] as const) {
            salida.push(
                r(
                    `argosisp:top sin fasttrack: clientes con colas (${sentido})`,
                    {
                        chain: 'forward',
                        'connection-state': 'established,related',
                        [campo]: 'argos-clientes',
                        action: 'accept',
                    },
                    true,
                ),
            )
        }
    }
    const corte = (comment: string, p: Propiedades) => r(comment, { chain: 'argos-corte', ...p })
    // DNS hacia CUALQUIER resolver (bug de producción v1.9.0, 5 nov): con el DNS limitado a `argos-dns`,
    // el cliente que consulta otro resolver (8.8.8.8 del perfil PPP, uno fijo en el CPE o en el teléfono)
    // no resolvía nada, nunca hacía la petición HTTP que el dst-nat lleva a /corte y el sistema decía
    // «sin internet» (Chrome: DNS_PROBE_STARTED). Se deja pasar la consulta tal cual: las respuestas son
    // las reales y no depende de que el router tenga `allow-remote-requests`. DoT (853) y DoH (443) siguen
    // cayendo en el `tcp-reset`, así que el equipo vuelve al DNS normal. Detalle: contratos/control-velocidad.md §10.5.
    salida.push(
        corte(REGLA_DNS_UDP, { protocol: 'udp', 'dst-port': '53', action: 'accept' }),
        corte(REGLA_DNS_TCP, { protocol: 'tcp', 'dst-port': '53', action: 'accept' }),
        corte('argosisp: corte portal', { 'dst-address-list': 'argos-portal', action: 'accept' }),
        corte('argosisp: corte walled garden', { 'dst-address-list': 'argos-walled', action: 'accept' }),
        corte('argosisp: corte TCP reset', { protocol: 'tcp', action: 'reject', 'reject-with': 'tcp-reset' }),
        corte('argosisp: corte rechazo del resto', {
            action: 'reject',
            'reject-with': 'icmp-admin-prohibited',
        }),
    )
    const entrada = (comment: string, p: Propiedades) => r(comment, { chain: 'argos-corte-in', ...p })
    if (v6) {
        salida.push(
            entrada('argosisp: corte-in ICMPv6', { protocol: 'icmpv6', action: 'accept' }),
            entrada('argosisp: corte-in DHCPv6', { protocol: 'udp', 'dst-port': '547', action: 'accept' }),
        )
    }
    salida.push(
        entrada('argosisp: corte-in DNS udp', { protocol: 'udp', 'dst-port': '53', action: 'accept' }),
        entrada('argosisp: corte-in DNS tcp', { protocol: 'tcp', 'dst-port': '53', action: 'accept' }),
    )
    if (!v6) salida.push(entrada('argosisp: corte-in ICMP', { protocol: 'icmp', action: 'accept' }))
    salida.push(
        entrada('argosisp: corte-in TCP reset', {
            protocol: 'tcp',
            action: 'reject',
            'reject-with': 'tcp-reset',
        }),
        entrada('argosisp: corte-in rechazo del resto', {
            action: 'reject',
            'reject-with': 'icmp-admin-prohibited',
        }),
        r('argosisp: activo (Filter-Id neutro)', { chain: 'argos-activo', action: 'return' }),
    )
    return salida
}

/**
 * NAT del corte (IPv4 en `/ip/firewall/nat`; IPv6 en `/ipv6/firewall/nat`, solo con IPv6 del portal):
 * saltos `argosisp:top`, portal y walled garden sin NAT y TCP/80 → `/corte`. En IPv6 el salto coincide
 * con las sesiones que entraron con el perfil `suspendido` (lista de interfaces o address-list IPv6):
 * PPPoE al reconectar (`COA_SUSPENDER_CON_IPV6=disconnect`, el valor por defecto) y WISP por la entrada
 * IPv6 de `suspendidos` que pone el dispatcher.
 */
function reglasNat(
    lista: string,
    config: ConfigCorte,
    v6 = false,
): { reglas: ReglaCorte[]; conservar: string[] } {
    const r = (comment: string, propiedades: Propiedades, arriba = false): ReglaCorte => ({
        ruta: v6 ? NAT6 : NAT,
        comment,
        propiedades: { ...propiedades, disabled: 'no' },
        arriba,
    })
    const reglas = [
        r(
            'argosisp:top corte NAT por address-list',
            { chain: 'dstnat', 'src-address-list': lista, action: 'jump', 'jump-target': 'argos-corte-nat' },
            true,
        ),
        r(
            'argosisp:top corte NAT por interface-list',
            { chain: 'dstnat', 'in-interface-list': lista, action: 'jump', 'jump-target': 'argos-corte-nat' },
            true,
        ),
        r('argosisp: corte-nat portal sin NAT', {
            chain: 'argos-corte-nat',
            'dst-address-list': 'argos-portal',
            action: 'return',
        }),
        r('argosisp: corte-nat walled garden sin NAT', {
            chain: 'argos-corte-nat',
            'dst-address-list': 'argos-walled',
            action: 'return',
        }),
    ]
    const http = REGLA_NAT_HTTP
    if (v6) {
        // Sin IPv6 del portal no hay NAT IPv6: el HTTP por IPv6 recibe `tcp-reset` y el equipo cae a IPv4.
        if (!config.portal_v6) return { reglas: [], conservar: [] }
        reglas.push(
            r(http, {
                chain: 'argos-corte-nat',
                protocol: 'tcp',
                'dst-port': '80',
                action: 'dst-nat',
                'to-address': `${config.portal_v6}/128`,
                'to-ports': String(config.portal_puerto),
            }),
        )
        return { reglas, conservar: [] }
    }
    if (!config.portal_v4) return { reglas, conservar: [http] }
    reglas.push(
        r(http, {
            chain: 'argos-corte-nat',
            protocol: 'tcp',
            'dst-port': '80',
            action: 'dst-nat',
            'to-addresses': config.portal_v4,
            'to-ports': String(config.portal_puerto),
        }),
    )
    return { reglas, conservar: [] }
}

/** Comentarios de reglas de corte que ArgosIsp administra (también las que hoy no hacen falta). */
function comentariosPropios(config: ConfigCorte): Map<RutaOrdenada, Set<string>> {
    const todas = [
        ...reglasFiltro(FILTRO, config.address_list, true),
        ...reglasFiltro(FILTRO6, config.address_list, true),
        ...reglasNat(config.address_list, { ...config, portal_v4: config.portal_v4 ?? '0.0.0.0' }).reglas,
        ...reglasNat(config.address_list, { ...config, portal_v6: config.portal_v6 ?? '::' }, true).reglas,
    ]
    const salida = new Map<RutaOrdenada, Set<string>>()
    for (const regla of todas) {
        const set = salida.get(regla.ruta) ?? new Set<string>()
        set.add(regla.comment)
        salida.set(regla.ruta, set)
    }
    for (const ruta of [FILTRO, FILTRO6] as const) {
        for (const comment of REGLAS_RETIRADAS) salida.get(ruta)!.add(comment)
    }
    return salida
}

function perfilBase(perfiles: ObjetoRouterOS[]): Propiedades {
    const base = perfiles.find((p) => p.name === PERFIL_PPP_BASE)
    const salida: Propiedades = {}
    if (!base) return salida
    for (const prop of PROPIEDADES_PERFIL_BASE) {
        const valor = base[prop]
        if (valor !== undefined && valor !== '') salida[prop] = valor
    }
    return salida
}

/** Una dirección IPv6 suelta se guarda como /128 (RouterOS la muestra así). */
export function normalizarDireccion(address: string): string {
    if (address.endsWith('/32') && isIPv4(address.slice(0, -3))) return address.slice(0, -3)
    if (address.endsWith('/128') && isIPv6(address.slice(0, -4))) return address.slice(0, -4).toLowerCase()
    return address.toLowerCase()
}

export function estadoCorteRouter(
    config: ConfigCorte,
    opciones: OpcionesCorte,
    perfiles: ObjetoRouterOS[],
): EstadoCorte {
    const avisos: string[] = []
    const lista = config.address_list
    const nombrados: EstadoCorte['nombrados'] = [
        {
            ruta: '/interface/list',
            name: lista,
            propiedades: { comment: 'argosisp: interfaces PPP suspendidas' },
        },
        {
            ruta: '/ppp/profile',
            name: config.perfil,
            propiedades: {
                ...perfilBase(perfiles),
                ...(opciones.local_address ? { 'local-address': opciones.local_address } : {}),
                'rate-limit': config.susp_rate_limit,
                'address-list': lista,
                'interface-list': lista,
                comment: 'argosisp: servicio suspendido',
            },
        },
    ]

    const entradas: EntradaListaCorte[] = []
    const grupos: GrupoListaCorte[] = []
    const agregar = (
        ruta: EntradaListaCorte['ruta'],
        list: string,
        comment: string,
        direcciones: Array<string | null>,
    ) => {
        const validas = direcciones.filter((d): d is string => d !== null && d !== '')
        if (validas.length === 0) return
        grupos.push({ ruta, list, comment })
        for (const address of validas) entradas.push({ ruta, list, address, comment })
    }
    const v4 = '/ip/firewall/address-list'
    const v6 = '/ipv6/firewall/address-list'
    agregar(v4, lista, 'argosisp: corte lista suspendidos', [ENTRADA_SUSPENDIDOS])
    agregar(v4, 'argos-portal', 'argosisp: portal IP', [config.portal_v4])
    agregar(v4, 'argos-portal', 'argosisp: portal FQDN', [config.portal_fqdn])
    // DNS del router = el `local-address` que ve cada cliente: el gateway efectivo de cada red del router
    // (contratos/red-acceso.md §2). `ROUTERS_SERVICIO_PPP_LOCAL_V4` solo si el router no tiene redes.
    const dnsRouter =
        opciones.gateways_v4 && opciones.gateways_v4.length > 0 ? opciones.gateways_v4 : [config.ppp_local_v4]
    agregar(v4, 'argos-dns', 'argosisp: DNS del router', dnsRouter)
    agregar(v4, 'argos-dns', 'argosisp: DNS', config.dns_v4)
    agregar(v4, 'argos-walled', 'argosisp: walled garden', config.walled_garden)
    agregar(v4, 'argos-clientes', 'argosisp: clientes PPPoE', config.clientes_v4)
    agregar(v4, 'argos-clientes', 'argosisp: clientes WISP', opciones.redes_v4)
    agregar(v6, 'argos-portal', 'argosisp: portal IP', [config.portal_v6])
    agregar(v6, 'argos-portal', 'argosisp: portal FQDN', [config.portal_fqdn])
    agregar(v6, 'argos-dns', 'argosisp: DNS', config.dns_v6)
    agregar(v6, 'argos-walled', 'argosisp: walled garden', config.walled_garden)
    agregar(v6, 'argos-clientes', 'argosisp: clientes IPv6', config.clientes_v6)

    const nat = reglasNat(lista, config)
    if (config.portal_v4_error) {
        avisos.push(config.portal_v4_error)
    } else if (!config.portal_v4) {
        avisos.push(
            'sin IPv4 del portal (ROUTERS_SERVICIO_PORTAL_V4, o PORTAL_URL_PUBLICA con IP o con un nombre que resuelva): no se escribe el NAT de HTTP a /corte',
        )
    }
    const nat6 = reglasNat(lista, config, true)
    if (!config.portal_v6) {
        avisos.push(
            'sin IPv6 del portal (ROUTERS_SERVICIO_PORTAL_V6): el HTTP por IPv6 de un suspendido recibe tcp-reset y el equipo cae a IPv4 para llegar a /corte',
        )
    }
    if (!config.portal_fqdn && !config.portal_v4) {
        avisos.push('sin portal configurado: argos-portal queda vacía')
    }
    if (opciones.fasttrack && config.clientes_v4.length === 0 && opciones.redes_v4.length === 0) {
        avisos.push(
            'sin redes de clientes (ROUTERS_SERVICIO_CLIENTES_V4 o redes IPv4 del router): argos-clientes vacía',
        )
    }
    return {
        nombrados,
        entradas,
        grupos,
        reglas: [
            ...reglasFiltro(FILTRO, lista, opciones.fasttrack),
            ...reglasFiltro(FILTRO6, lista, opciones.fasttrack),
            ...nat.reglas,
            ...nat6.reglas,
        ],
        propias: comentariosPropios(config),
        conservar: new Set(nat.conservar),
        avisos,
    }
}

/** ¿Es una regla `argosisp:top` (de ArgosIsp o del script)? */
export function esArriba(objeto: ObjetoRouterOS): boolean {
    return (objeto.comment ?? '').startsWith('argosisp:top')
}

/**
 * Orden deseado de una tabla (ids de las reglas no dinámicas): primero las `argosisp:top` que no son
 * nuestras (las del script: CoA, DNS, WireGuard) en su orden, luego las nuestras de arriba en el orden
 * declarado; después el resto de la tabla tal como está, con nuestras cadenas juntas y en orden donde
 * aparece la primera. Así lo que dejó `lab.rsc` ya está en orden y no se mueve nada.
 */
export function ordenDeseado(tabla: ObjetoRouterOS[], reglas: ReglaCorte[]): string[] {
    const estaticas = tabla.filter((o) => o.dynamic !== 'true')
    const porComment = new Map(estaticas.map((o) => [o.comment ?? '', o]))
    const arribaPropias = reglas.filter((r) => r.arriba).map((r) => porComment.get(r.comment)?.['.id'])
    const cadenasPropias = reglas.filter((r) => !r.arriba).map((r) => porComment.get(r.comment)?.['.id'])
    const propias = new Set([...arribaPropias, ...cadenasPropias].filter((x): x is string => x !== undefined))
    const otrasArriba = estaticas.filter((o) => esArriba(o) && !propias.has(o['.id'])).map((o) => o['.id'])
    const resto: string[] = []
    let insertadas = false
    for (const o of estaticas) {
        if (esArriba(o) && !propias.has(o['.id'])) continue
        if (propias.has(o['.id'])) {
            if (!arribaPropias.includes(o['.id']) && !insertadas) {
                resto.push(...cadenasPropias.filter((x): x is string => x !== undefined))
                insertadas = true
            }
            continue
        }
        resto.push(o['.id'])
    }
    if (!insertadas) resto.push(...cadenasPropias.filter((x): x is string => x !== undefined))
    return [...otrasArriba, ...arribaPropias.filter((x): x is string => x !== undefined), ...resto]
}

/**
 * Movimientos para llevar la tabla al orden deseado: `move <id> destination=<id>` (antes de), uno por
 * posición fuera de lugar. Vacío si ya está en orden.
 */
export function movimientos(
    tabla: ObjetoRouterOS[],
    deseado: string[],
): Array<{ id: string; destino: string }> {
    const actual = tabla.filter((o) => o.dynamic !== 'true').map((o) => o['.id'])
    const salida: Array<{ id: string; destino: string }> = []
    for (const [i, element] of deseado.entries()) {
        if (actual[i] === element) continue
        const id = element!
        const destino = actual[i]!
        salida.push({ id, destino })
        actual.splice(actual.indexOf(id), 1)
        actual.splice(i, 0, id)
    }
    return salida
}

/**
 * ¿Un cambio del reconciliador es del corte (no de un servicio ni de la velocidad)? Para separarlos en
 * la vista previa y en las pruebas.
 */
export function esCambioDeCorte(c: { ruta: string; comment: string }): boolean {
    if (
        c.ruta === '/interface/list' ||
        c.ruta.endsWith('/firewall/filter') ||
        c.ruta.endsWith('/firewall/nat')
    ) {
        return true
    }
    if (c.ruta === '/ppp/profile') return !c.comment.startsWith('argosisp:plan:')
    return c.ruta.endsWith('/address-list') && !c.comment.startsWith('argosisp:servicio:')
}

/*
|--------------------------------------------------------------------------
| DNS del router (bug v1.9.0, 5 nov)
|--------------------------------------------------------------------------
| En el router del PM `/ip dns servers` tenía las IPs de documentación de `lab-sin-radius.rsc`
| (192.0.2.53, 198.51.100.53, 2001:db8:ffff::53): el resolver del router no resolvía nada y los
| clientes que lo usan quedaban sin DNS (`DNS_PROBE_STARTED`). ArgosIsp nunca cambia los DNS del router
| (son del operador): lo detecta, lo muestra en el diagnóstico y emite `routeros.fallido`.
*/

/** Rangos de documentación (RFC 5737 y RFC 3849): nunca son un DNS real. */
export function esIpDocumentacion(ip: string): boolean {
    const v = ip.trim().toLowerCase()
    if (isIPv4(v)) return /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(v)
    if (isIPv6(v)) return /^2001:0?db8(:|$)/.test(v)
    return false
}

export interface ProblemaDnsRouter {
    codigo: 'dns_router_sin_servidores' | 'dns_router_documentacion' | 'dns_router_sin_remotas'
    mensaje: string
    comandos: string[]
}

/**
 * Qué está mal en `/ip dns` del router. `usaDnsRouter`: los clientes reciben el router como DNS (el
 * `dns-server` del perfil PPP es un gateway del router, o el router es el DNS de las redes WISP); solo
 * entonces hace falta `allow-remote-requests`.
 */
export function revisarDnsRouter(
    dns: Record<string, string | undefined>,
    usaDnsRouter: boolean,
): ProblemaDnsRouter[] {
    const salida: ProblemaDnsRouter[] = []
    const servidores = separar(dns.servers)
    const dinamicos = separar(dns['dynamic-servers'])
    const arreglo = '/ip dns set servers=<DNS reales de tu proveedor, p. ej. 1.1.1.1,8.8.8.8>'
    if (servidores.length === 0 && dinamicos.length === 0) {
        salida.push({
            codigo: 'dns_router_sin_servidores',
            mensaje:
                'El router no tiene servidores DNS (/ip dns servers vacío y sin DNS dinámicos): no resuelve nada y los ' +
                'clientes que lo usan como DNS no navegan ni ven la página de corte. Pon los DNS de tu proveedor',
            comandos: [arreglo, '/ip dns print'],
        })
    }
    const documentacion = [...servidores, ...dinamicos].filter(esIpDocumentacion)
    if (documentacion.length > 0) {
        salida.push({
            codigo: 'dns_router_documentacion',
            mensaje:
                `El router usa como DNS ${documentacion.join(', ')}: son direcciones de documentación (RFC 5737 / RFC ` +
                '3849, ejemplos de los scripts), no responden. El router no resuelve y el suspendido ve «sin internet» ' +
                'en lugar de la página de corte. Cámbialos por los DNS reales de tu proveedor',
            comandos: [arreglo, '/ip dns cache flush', ':put [:resolve connectivitycheck.gstatic.com]'],
        })
    }
    const remotas = dns['allow-remote-requests']
    if (usaDnsRouter && remotas !== undefined && remotas !== 'true' && remotas !== 'yes') {
        salida.push({
            codigo: 'dns_router_sin_remotas',
            mensaje:
                'Los clientes reciben al router como DNS pero /ip dns tiene allow-remote-requests=no: el router no les ' +
                'responde. Actívalo (el script de conexión ya bloquea el 53 desde la WAN)',
            comandos: ['/ip dns set allow-remote-requests=yes'],
        })
    }
    return salida
}

/** ¿Los clientes usan al router como DNS? (`dns-server` del perfil `default` o `suspendido` = un gateway). */
export function clientesUsanDnsRouter(perfiles: ObjetoRouterOS[], gateways: Array<string | null>): boolean {
    const propios = new Set(gateways.filter((g): g is string => !!g))
    if (propios.size === 0) return false
    return perfiles
        .filter((p) => p.name === PERFIL_PPP_BASE || p.name === 'suspendido')
        .some((p) => separar(p['dns-server']).some((d) => propios.has(d)))
}
