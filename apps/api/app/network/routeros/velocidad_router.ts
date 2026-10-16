import { formatoKbps, limitesPadrePlan, type ControlVelocidad, type VelocidadPlan } from '#network/velocidad'
import type { ObjetoRouterOS, Propiedades, RutaRouterOS } from '#network/routeros/cliente'

/**
 * Estado deseado del control de velocidad de un router (`contratos/velocidad.md`): los objetos por
 * plan y por router, no los de cada servicio (esos están en `estado_deseado.ts`). Función pura: con
 * lo que dice Postgres (planes del router, servicios que cuentan) y lo que se leyó del router (perfil
 * PPP base, colas dinámicas de PPPoE), qué debe existir.
 *
 * Modo `simple` con reuso (plan con `reuso > 1` efectivo en el router):
 *
 * | Menú | Clave | Propiedades |
 * | --- | --- | --- |
 * | `/queue/simple` | `comment = argosisp:plan:<id>` | `name = argosisp-plan-<id>`, `max-limit` y `limit-at` de `limitesPadrePlan(plan, activos)`, prioridad del plan, `target` = las hijas |
 * | `/ppp/profile` | `comment = argosisp:plan:<id>` | `name = plan-<id>`, `parent-queue = argosisp-plan-<id>` y lo del perfil `default` (pools, DNS, IPv6) |
 *
 * - Las colas WISP del plan llevan `parent = argosisp-plan-<id>` (`estado_deseado.ts`) y las de
 *   PPPoE cuelgan del padre por el perfil (`aaa` manda `Mikrotik-Group = plan-<id>`).
 * - `activos` = servicios del plan en el router que no están suspendidos ni retirados.
 * - `target` del padre = los `target` de sus hijas (colas WISP deseadas y colas dinámicas de PPPoE
 *   que el router ya puso bajo el padre). Un padre con un `target` amplio (la red de clientes)
 *   capturaría el tráfico de clientes de otros planes; sin hijas se usa `TARGET_SIN_HIJAS`.
 * - El padre existe mientras el plan tenga servicios no retirados en el router o colas dinámicas
 *   colgando de él; un perfil PPP nunca apunta a una cola que no existe.
 */

export const PREFIJO_COMMENT_PLAN = 'argosisp:plan:'
export const PREFIJO_COMMENT_GLOBAL = 'argosisp:global:'

/** Dirección de documentación (RFC 5737): nunca la tiene un cliente. `target` de un padre sin hijas. */
export const TARGET_SIN_HIJAS = '192.0.2.255/32'

/** Perfil PPP del que se copian pools, DNS e IPv6 (el `default-profile` del PPPoE server). */
export const PERFIL_PPP_BASE = 'default'

/** Propiedades del perfil base que se copian a `plan-<id>` (nunca `rate-limit` ni `parent-queue`). */
export const PROPIEDADES_PERFIL_BASE = [
    'local-address',
    'remote-address',
    'remote-ipv6-prefix-pool',
    'dhcpv6-pd-pool',
    'use-ipv6',
    'dns-server',
    'wins-server',
    'change-tcp-mss',
    'use-compression',
    'use-encryption',
    'use-mpls',
    'use-upnp',
    'only-one',
    'idle-timeout',
    'session-timeout',
    'address-list',
    'interface-list',
    'incoming-filter',
    'outgoing-filter',
    'bridge',
    'on-up',
    'on-down',
] as const

export function commentPlan(planId: number): string {
    return `${PREFIJO_COMMENT_PLAN}${planId}`
}

/** `name` de la cola padre del plan (modo `simple`). */
export function nombrePadre(planId: number): string {
    return `argosisp-plan-${planId}`
}

/** `name` del perfil PPP del plan (`Mikrotik-Group` que manda `aaa`). */
export function nombrePerfil(planId: number): string {
    return `plan-${planId}`
}

/** `argosisp:plan:<id>` → id; null si no es un comment de plan. */
export function planDeComment(comment: string | undefined): number | null {
    if (!comment?.startsWith(PREFIJO_COMMENT_PLAN)) return null
    const id = Number(comment.slice(PREFIJO_COMMENT_PLAN.length).split(':')[0])
    return Number.isInteger(id) && id > 0 ? id : null
}

/** ¿El plan lleva cola padre en modo `simple`? (reuso efectivo en el router > 1) */
export function conPadreSimple(control: ControlVelocidad, velocidad: Pick<VelocidadPlan, 'reuso'>): boolean {
    return control === 'simple' && velocidad.reuso > 1
}

export interface RouterVelocidad {
    router_id: number
    control: ControlVelocidad
    capacidad_bajada_kbps: number | null
    capacidad_subida_kbps: number | null
}

/** Un plan con servicios (no retirados) en el router. */
export interface PlanRouter {
    plan_id: number
    /** Velocidad efectiva en el router (plantilla + `planes_routers`) */
    velocidad: VelocidadPlan
    /** Servicios no retirados del plan en el router (de cualquier tipo) */
    servicios: number
    /** Los que cuentan para el padre: ni suspendidos ni retirados (activos + limitados) */
    activos: number
    /** Solo en estado `activo` (hijo del plan en `arbol_pcq`) */
    en_activo: number
    /** Solo en estado `limitado` (hijo del plan limitado en `arbol_pcq`) */
    en_limitado: number
    /** `target` de las colas WISP del plan que cuelgan del padre (activas y limitadas) */
    targets_wisp: string[]
}

/** Un objeto del control de velocidad: menú, clave de identidad (`comment` o `name`) y propiedades. */
export interface ObjetoVelocidad {
    ruta: RutaRouterOS
    clave: Propiedades
    propiedades: Propiedades
}

export interface EstadoVelocidad {
    /** En orden de creación (padres antes que hijas) */
    presentes: ObjetoVelocidad[]
    avisos: string[]
    /** Objetos existentes que no se tocan ni se borran (`ruta|clave`) */
    conservar: string[]
}

/** Menús con objetos de velocidad, en el orden en que se borran los sobrantes (hijas primero). */
export const MENUS_VELOCIDAD = [
    '/ip/firewall/mangle',
    '/ipv6/firewall/mangle',
    '/ppp/profile',
    '/queue/simple',
    '/queue/tree',
    '/queue/type',
] as const satisfies readonly RutaRouterOS[]
export type MenuVelocidad = (typeof MENUS_VELOCIDAD)[number]

/** Lo que se leyó del router (un `listar` por menú). */
export type LecturaVelocidad = Map<MenuVelocidad, ObjetoRouterOS[]>

/**
 * Tipos de cola PCQ de ArgosIsp. `/queue/type` no tiene `comment`: se identifican por nombre. El
 * plan `0` es el ejemplo de `lab.rsc` (ningún plan real tiene id 0) y no se toca.
 */
const NOMBRE_TIPO = /^argosisp-plan-[1-9]\d*-(?:limitado-)?(?:bajada|subida)$/

/** ¿Es un objeto del control de velocidad que ArgosIsp administra en ese menú? */
export function esObjetoVelocidad(ruta: MenuVelocidad, objeto: ObjetoRouterOS): boolean {
    if (objeto.dynamic === 'true') return false
    if (ruta === '/queue/type') return NOMBRE_TIPO.test(objeto.name ?? '')
    const comment = objeto.comment ?? ''
    return comment.startsWith(PREFIJO_COMMENT_PLAN) || comment.startsWith(PREFIJO_COMMENT_GLOBAL)
}

export type Sentido = 'bajada' | 'subida'
export const SENTIDOS: readonly Sentido[] = ['bajada', 'subida']

/** Padre global del árbol (`arbol_pcq`): `argosisp-global-<sentido>`, `comment = argosisp:global:<sentido>`. */
export function nombreGlobal(sentido: Sentido): string {
    return `argosisp-global-${sentido}`
}

/**
 * Address-list del plan en `arbol_pcq` (IPv4 e IPv6, mismo nombre): `argosisp-plan-<id>` o
 * `argosisp-plan-<id>-limitado`.
 */
export function listaPlan(planId: number, limitado: boolean): string {
    return `argosisp-plan-${planId}${limitado ? '-limitado' : ''}`
}

/** Nombre del tipo PCQ, del nodo del árbol y de la marca de paquete: `argosisp-plan-<id>[-limitado]-<sentido>`. */
export function nombreNodo(planId: number, limitado: boolean, sentido: Sentido): string {
    return `${listaPlan(planId, limitado)}-${sentido}`
}

function commentNodo(planId: number, limitado: boolean, sentido: Sentido): string {
    return `${commentPlan(planId)}${limitado ? ':limitado' : ''}:${sentido}`
}

/** Clave estable de un objeto para comparar deseado y actual. */
export function claveTexto(clave: Propiedades): string {
    return Object.entries(clave)
        .map(([k, v]) => `${k}=${v}`)
        .join(';')
}

function perfilBase(lectura: LecturaVelocidad): Propiedades {
    const base = (lectura.get('/ppp/profile') ?? []).find((p) => p.name === PERFIL_PPP_BASE)
    const salida: Propiedades = {}
    if (!base) return salida
    for (const prop of PROPIEDADES_PERFIL_BASE) {
        const valor = base[prop]
        if (valor !== undefined && valor !== '') salida[prop] = valor
    }
    return salida
}

/** Colas dinámicas (PPPoE) que el router ya colgó de cada padre: `name del padre → targets`. */
function hijasDinamicas(lectura: LecturaVelocidad): Map<string, string[]> {
    const salida = new Map<string, string[]>()
    for (const cola of lectura.get('/queue/simple') ?? []) {
        if (cola.dynamic !== 'true' || !cola.parent || cola.parent === 'none' || !cola.target) continue
        const lista = salida.get(cola.parent) ?? []
        lista.push(...cola.target.split(',').filter((t) => t !== ''))
        salida.set(cola.parent, lista)
    }
    return salida
}

const dobles = (n: number) => `${n}/${n}`

export function estadoVelocidadRouter(
    router: RouterVelocidad,
    planes: PlanRouter[],
    lectura: LecturaVelocidad,
): EstadoVelocidad {
    const presentes: ObjetoVelocidad[] = []
    const avisos: string[] = []
    const conservar: string[] = []
    if (router.control === 'arbol_pcq') {
        // Padres de `simple` con sesiones PPPoE todavía colgando (cambio de modo en curso): quedan
        // hasta que la sesión reconecte; los borra el `sesion.terminada` de la última.
        const arbol = estadoArbol(router, planes)
        for (const nombre of hijasDinamicas(lectura).keys()) {
            const id = /^argosisp-plan-(\d+)$/.exec(nombre)?.[1]
            if (!id) continue
            arbol.conservar.push(`/queue/simple|${claveTexto({ comment: commentPlan(Number(id)) })}`)
            arbol.conservar.push(`/ppp/profile|${claveTexto({ comment: commentPlan(Number(id)) })}`)
        }
        return arbol
    }

    const dinamicas = hijasDinamicas(lectura)
    const base = perfilBase(lectura)
    const conDinamicas = new Set(
        [...dinamicas.keys()]
            .map((nombre) => /^argosisp-plan-(\d+)$/.exec(nombre)?.[1])
            .filter((id): id is string => id !== undefined)
            .map(Number),
    )
    const padres = new Map<number, PlanRouter | null>()
    for (const plan of planes) {
        if (conPadreSimple(router.control, plan.velocidad)) padres.set(plan.plan_id, plan)
    }
    // Un plan sin servicios aquí pero con sesiones colgando del padre: el padre queda (sin activos).
    for (const id of conDinamicas) if (!padres.has(id)) padres.set(id, null)

    const colas: ObjetoVelocidad[] = []
    const perfiles: ObjetoVelocidad[] = []
    for (const [planId, plan] of [...padres].sort((a, b) => a[0] - b[0])) {
        const nombre = nombrePadre(planId)
        const targets = [...new Set([...(plan?.targets_wisp ?? []), ...(dinamicas.get(nombre) ?? [])])]
        if (!plan) {
            // Sin datos del plan en este router no se recalcula: se conserva tal cual está.
            avisos.push(`plan ${planId}: sin servicios en el router pero con sesiones bajo ${nombre}`)
            conservar.push(`/queue/simple|${claveTexto({ comment: commentPlan(planId) })}`)
            conservar.push(`/ppp/profile|${claveTexto({ comment: commentPlan(planId) })}`)
            continue
        }
        const limites = limitesPadrePlan(plan.velocidad, plan.activos)
        colas.push({
            ruta: '/queue/simple',
            clave: { comment: commentPlan(planId) },
            propiedades: {
                name: nombre,
                target: targets.length > 0 ? targets.join(',') : TARGET_SIN_HIJAS,
                'max-limit': limites.max_limit,
                'limit-at': limites.limit_at,
                priority: dobles(limites.prioridad),
                'burst-limit': '0/0',
                'burst-threshold': '0/0',
                'burst-time': '0s/0s',
                parent: 'none',
                disabled: 'no',
            },
        })
        perfiles.push({
            ruta: '/ppp/profile',
            clave: { comment: commentPlan(planId) },
            propiedades: { ...base, name: nombrePerfil(planId), 'parent-queue': nombre },
        })
    }
    presentes.push(...colas, ...perfiles)
    return { presentes, avisos, conservar }
}

/**
 * Modo `arbol_pcq` (`contratos/velocidad.md`, "Modo arbol_pcq"), en orden de creación:
 *
 * 1. `/queue/type` por plan y sentido: `argosisp-plan-<id>[-limitado]-<sentido>`, `kind = pcq`,
 *    `pcq-rate` = MIR (o el limitado), clasificador `dst-address` (bajada) / `src-address` (subida)
 *    y máscara /64 en IPv6 (un cliente = un /64, no una dirección).
 * 2. `/queue/tree` globales `argosisp-global-bajada|subida` (`parent = global`, `max-limit` =
 *    capacidad del enlace; 0 = sin techo).
 * 3. `/queue/tree` por plan y sentido, hijos del global: `packet-mark` y `queue` = el tipo PCQ,
 *    `max-limit` / `limit-at` de `limitesPadrePlan(plan, activos)` y la prioridad del plan. El plan
 *    limitado tiene su propio nodo, con la velocidad limitada y sus servicios limitados.
 * 4. Mangle IPv4 e IPv6 (`chain = forward`, `mark-packet`, `passthrough = no`): destino en la lista
 *    del plan → marca de bajada; origen → marca de subida.
 *
 * Las listas (`argosisp-plan-<id>[-limitado]`) las llena el dispatcher por servicio
 * (`estado_deseado.ts`): IPv4, /64 y /56 de cada servicio activo o limitado. Sin colas simples
 * por servicio (salvo el WISP suspendido, como la dinámica del PPPoE suspendido).
 */
function estadoArbol(router: RouterVelocidad, planes: PlanRouter[]): EstadoVelocidad {
    const tipos: ObjetoVelocidad[] = []
    const globales: ObjetoVelocidad[] = []
    const nodos: ObjetoVelocidad[] = []
    const mangles: ObjetoVelocidad[] = []
    const capacidad = { bajada: router.capacidad_bajada_kbps, subida: router.capacidad_subida_kbps }
    for (const sentido of SENTIDOS) {
        globales.push({
            ruta: '/queue/tree',
            clave: { comment: `${PREFIJO_COMMENT_GLOBAL}${sentido}` },
            propiedades: {
                name: nombreGlobal(sentido),
                parent: 'global',
                'max-limit': formatoKbps(capacidad[sentido] ?? 0),
                disabled: 'no',
            },
        })
    }
    for (const plan of [...planes].sort((a, b) => a.plan_id - b.plan_id)) {
        for (const limitado of [false, true]) {
            const vel = limitado
                ? {
                      ...plan.velocidad,
                      bajada_kbps: plan.velocidad.bajada_limitada_kbps,
                      subida_kbps: plan.velocidad.subida_limitada_kbps,
                  }
                : plan.velocidad
            const limites = limitesPadrePlan(vel, limitado ? plan.en_limitado : plan.en_activo)
            const lista = listaPlan(plan.plan_id, limitado)
            for (const sentido of SENTIDOS) {
                const nombre = nombreNodo(plan.plan_id, limitado, sentido)
                const bajada = sentido === 'bajada'
                tipos.push({
                    ruta: '/queue/type',
                    clave: { name: nombre },
                    propiedades: {
                        kind: 'pcq',
                        'pcq-rate': formatoKbps(bajada ? vel.bajada_kbps : vel.subida_kbps),
                        'pcq-classifier': bajada ? 'dst-address' : 'src-address',
                        ...(bajada ? { 'pcq-dst-address6-mask': '64' } : { 'pcq-src-address6-mask': '64' }),
                    },
                })
                nodos.push({
                    ruta: '/queue/tree',
                    clave: { comment: commentNodo(plan.plan_id, limitado, sentido) },
                    propiedades: {
                        name: nombre,
                        parent: nombreGlobal(sentido),
                        'packet-mark': nombre,
                        queue: nombre,
                        'max-limit': formatoKbps(limites.max_limit_kbps[sentido]),
                        'limit-at': formatoKbps(limites.limit_at_kbps[sentido]),
                        priority: String(limites.prioridad),
                        disabled: 'no',
                    },
                })
                for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const) {
                    mangles.push({
                        ruta,
                        clave: { comment: commentNodo(plan.plan_id, limitado, sentido) },
                        propiedades: {
                            chain: 'forward',
                            action: 'mark-packet',
                            [bajada ? 'dst-address-list' : 'src-address-list']: lista,
                            'new-packet-mark': nombre,
                            passthrough: 'no',
                            disabled: 'no',
                        },
                    })
                }
            }
        }
    }
    return { presentes: [...tipos, ...globales, ...nodos, ...mangles], avisos: [], conservar: [] }
}

/**
 * Objetos de velocidad que hay en el router y no deben estar, en orden de borrado (perfiles antes
 * que la cola a la que apuntan). Un padre que todavía tiene colas dinámicas colgando no se borra
 * (`estadoVelocidadRouter` lo conserva).
 */
export function sobrantesVelocidad(
    estado: EstadoVelocidad,
    lectura: LecturaVelocidad,
): Array<{ ruta: MenuVelocidad; objeto: ObjetoRouterOS }> {
    const deseadas = new Set([
        ...estado.presentes.map((o) => `${o.ruta}|${claveTexto(o.clave)}`),
        ...estado.conservar,
    ])
    const salida: Array<{ ruta: MenuVelocidad; objeto: ObjetoRouterOS }> = []
    for (const ruta of MENUS_VELOCIDAD) {
        const sobran = (lectura.get(ruta) ?? []).filter((objeto) => {
            if (!esObjetoVelocidad(ruta, objeto)) return false
            const clave: Propiedades =
                ruta === '/queue/type' ? { name: objeto.name! } : { comment: objeto.comment! }
            return !deseadas.has(`${ruta}|${claveTexto(clave)}`)
        })
        // En el árbol, los nodos de plan antes que los globales de los que cuelgan.
        const global = (o: ObjetoRouterOS) => (o.comment?.startsWith(PREFIJO_COMMENT_GLOBAL) ? 1 : 0)
        for (const objeto of sobran.sort((a, b) => global(a) - global(b))) salida.push({ ruta, objeto })
    }
    return salida
}
