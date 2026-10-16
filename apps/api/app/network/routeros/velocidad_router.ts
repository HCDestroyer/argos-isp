import { limitesPadrePlan, type ControlVelocidad, type VelocidadPlan } from '#network/velocidad'
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
    /** Los que cuentan para el padre: ni suspendidos ni retirados */
    activos: number
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
export const MENUS_VELOCIDAD = ['/ppp/profile', '/queue/simple'] as const satisfies readonly RutaRouterOS[]
export type MenuVelocidad = (typeof MENUS_VELOCIDAD)[number]

/** Lo que se leyó del router (un `listar` por menú). */
export type LecturaVelocidad = Map<MenuVelocidad, ObjetoRouterOS[]>

/** ¿Es un objeto del control de velocidad que ArgosIsp administra en ese menú? */
export function esObjetoVelocidad(_ruta: MenuVelocidad, objeto: ObjetoRouterOS): boolean {
    const comment = objeto.comment ?? ''
    if (objeto.dynamic === 'true') return false
    return comment.startsWith(PREFIJO_COMMENT_PLAN) || comment.startsWith(PREFIJO_COMMENT_GLOBAL)
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
    if (router.control !== 'simple') return { presentes, avisos, conservar }

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
        for (const objeto of lectura.get(ruta) ?? []) {
            if (!esObjetoVelocidad(ruta, objeto)) continue
            if (deseadas.has(`${ruta}|${claveTexto({ comment: objeto.comment! })}`)) continue
            salida.push({ ruta, objeto })
        }
    }
    return salida
}
