import {
    formatoKbps,
    limitesPadrePlan,
    rateLimitServicio,
    type ControlVelocidad,
    type LimitesPadre,
    type VelocidadPlan,
} from '#network/velocidad'
import {
    COMMENT_PADRE_ROUTER,
    conNivelPlan,
    conNivelRouter,
    familia,
    kindTipoHoja,
    NOMBRE_PADRE_ROUTER,
    nombrePadrePlan,
    nombreTipoHoja,
    padreCliente,
    conQos,
    velocidadConExtras,
    type Estrategia,
    type EstrategiasRouter,
    type Familia,
    type TipoCola,
} from '#network/estrategia_velocidad'
import type { ObjetoRouterOS, Propiedades, RutaRouterOS } from '#network/routeros/cliente'
import {
    claseResto,
    objetosClasificacion,
    objetosQosPlan,
    PREFIJO_COMMENT_QOS,
    QOS_MAX_HOJAS,
    type PerfilQosRouter,
} from '#network/qos'
import { normalizarValor } from '#network/routeros/normalizar'
import { perfilesLocales, type PoolsPlan } from '#network/routeros/pppoe_local'

/**
 * Estado deseado del control de velocidad de un router (`contratos/control-velocidad.md`): los
 * objetos por plan y por router, no los de cada servicio (esos están en `estado_deseado.ts`). Función
 * pura: con lo que dice Postgres (grupos de plan × familia, de `planesDeRouter`) y lo que se leyó del
 * router (perfil PPP base, colas dinámicas de PPPoE), qué debe existir.
 *
 * Familia de colas simples (`radius_rate_limit`, `perfil_ppp`, `cola_simple`, `pcq_plan`):
 *
 * | Menú | Clave | Cuándo |
 * | --- | --- | --- |
 * | `/queue/type` `argosisp-sfq` / `-fq-codel` / `-cake` | `name` | Alguna hoja usa ese `tipo_cola` |
 * | `/queue/type` `argosisp-plan-<id>[-limitado]-pcq-<sentido>` | `name` | Plan con `pcq_plan` |
 * | `/queue/simple` `argosisp-router` | `comment = argosisp:router` | Algo usa `por_router` o `jerarquico` |
 * | `/queue/simple` `argosisp-plan-<id>` | `comment = argosisp:plan:<id>` | `por_plan` con reuso > 1, o `jerarquico` |
 * | `/queue/simple` `argosisp-plan-<id>-pcq[-limitado]` | `comment = argosisp:plan:<id>:pcq[:limitado]` | Plan con `pcq_plan` |
 * | `/ppp/profile` `plan-<id>` | `comment = argosisp:plan:<id>` | PPPoE con padre, `tipo_cola` propio o `perfil_ppp` |
 *
 * Familia árbol (`arbol_pcq`): tipos PCQ, nodos globales (con `por_router`/`jerarquico`), nodos del
 * plan y mangle, como hasta ahora.
 *
 * - `target` de cada cola padre = los `target` de sus hijas (colas WISP, colas `-pcq`, padres de plan y
 *   colas dinámicas de PPPoE que el router ya puso bajo ella). Un `target` amplio capturaría el
 *   tráfico de clientes de otros planes; sin hijas se usa `TARGET_SIN_HIJAS`.
 * - Un padre o perfil con colas dinámicas colgando no se borra (sesiones conectadas antes de un
 *   cambio): se conserva hasta que reconectan.
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

/** `name` de la cola padre del plan (familia de colas simples). */
export function nombrePadre(planId: number): string {
    return nombrePadrePlan(planId)
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

/**
 * ¿El plan lleva cola padre en modo `simple`? (reuso efectivo > 1). Se conserva por compatibilidad
 * con el modo obsoleto; el dispatcher usa `conNivelPlan` de la estrategia.
 */
export function conPadreSimple(control: ControlVelocidad, velocidad: Pick<VelocidadPlan, 'reuso'>): boolean {
    return control === 'simple' && velocidad.reuso > 1
}

export interface RouterVelocidad {
    router_id: number
    /** Derivado de `estrategias` (obsoleto) */
    control: ControlVelocidad
    estrategias: EstrategiasRouter
    capacidad_bajada_kbps: number | null
    capacidad_subida_kbps: number | null
    /** Versión de RouterOS leída del router (null = no se sabe) */
    routeros_version: string | null
    /**
     * Perfil de QoS del router (`contratos/qos.md`): el suyo o el predeterminado, con sus clases
     * activas. Solo se usa en los planes del árbol con el extra `qos`. null/ausente = sin QoS.
     */
    qos?: PerfilQosRouter | null
    /**
     * `network.routers.modo_seguridad` (ausente = `radius`). Con `api` (PPPoE sin RADIUS,
     * `contratos/pppoe-local.md`) los perfiles `plan-<id>` y `plan-<id>-limitado` los arma
     * `perfilesLocales`, en las dos familias.
     */
    modo_seguridad?: 'radius' | 'api'
}

/** Colas WISP (`cola_simple`) que cuelgan de un padre. */
export interface HijasWisp {
    /** `name` del padre (`argosisp-plan-<id>` o `argosisp-router`) */
    padre: string
    targets: string[]
    limit_at_kbps: { subida: number; bajada: number }
}

/** Clientes de la cola PCQ del plan (`pcq_plan`). */
export interface PcqPlan {
    estrategia: Estrategia
    activo: string[]
    limitado: string[]
}

/** Un plan con servicios en el router, en una familia de colas (grupo de `planesDeRouter`). */
export interface PlanRouter {
    plan_id: number
    familia: Familia
    /** Velocidad efectiva en el router (plantilla + `planes_routers`), sin extras */
    velocidad: VelocidadPlan
    /** Estrategia del grupo: la de lo que cuelga de un padre (padre y extras son los mismos, regla 6) */
    estrategia: Estrategia
    /** Servicios no retirados del plan en el grupo (de cualquier tipo) */
    servicios: number
    /** Los que cuentan para el padre del plan (ni suspendidos ni retirados y bajo el padre) */
    activos: number
    /** Árbol: en estado `activo` y en estado `limitado` */
    en_activo: number
    en_limitado: number
    /** Colas WISP del plan con padre */
    hijas: HijasWisp[]
    /** Cola PCQ del plan, si algún tipo usa `pcq_plan` */
    pcq: PcqPlan | null
    /** Estrategia PPPoE que necesita el perfil `plan-<id>`, o null */
    perfil: Estrategia | null
    /** Tipos de cola de las hojas (sin `default` ni `pcq`) */
    tipos_hoja: TipoCola[]
    /** Pools del plan en el router (solo sin RADIUS: van en sus perfiles) */
    pools?: PoolsPlan | null
}

/**
 * Valor de velocidad de RouterOS (`rx/tx`, con o sin sufijo, o bits como lo devuelve el router)
 * → kbps por sentido (`rx` = subida del cliente, `tx` = bajada).
 */
export function kbpsPar(valor: string | undefined): { subida: number; bajada: number } {
    const [rx = '0', tx = rx] = normalizarValor(valor ?? '0').split('/')
    const kbps = (v: string) => (Number.isFinite(Number(v)) ? Math.floor(Number(v) / 1000) : 0)
    return { subida: kbps(rx), bajada: kbps(tx) }
}

/** Regla de oro del contrato que el router no cumpliría (`routeros.fallido` con el detalle). */
export interface ErrorReglaOro {
    plan_id: number | null
    regla: 'limit_at_hijos' | 'limit_at_global' | 'limit_at_router' | 'ipv6' | 'qos_costo'
    detalle: string
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
    /**
     * Reglas de oro que no se cumplen: el padre (o el árbol) afectado no se escribe (queda como
     * está, en `conservar`) y el dispatcher emite `routeros.fallido` con el detalle.
     */
    errores: ErrorReglaOro[]
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
 * Tipos de cola de ArgosIsp. `/queue/type` no tiene `comment`: se identifican por nombre. El plan `0`
 * es el ejemplo de `lab.rsc` (ningún plan real tiene id 0) y no se toca.
 */
const NOMBRE_TIPO =
    /^(?:argosisp-plan-[1-9]\d*-(?:limitado-)?(?:pcq-)?(?:bajada|subida)(?:-q[1-9]\d*)?|argosisp-(?:sfq|fq-codel|cake))$/

/** ¿Es un objeto del control de velocidad que ArgosIsp administra en ese menú? */
export function esObjetoVelocidad(ruta: MenuVelocidad, objeto: ObjetoRouterOS): boolean {
    if (objeto.dynamic === 'true') return false
    if (ruta === '/queue/type') return NOMBRE_TIPO.test(objeto.name ?? '')
    const comment = objeto.comment ?? ''
    return (
        comment.startsWith(PREFIJO_COMMENT_PLAN) ||
        comment.startsWith(PREFIJO_COMMENT_GLOBAL) ||
        comment.startsWith(PREFIJO_COMMENT_QOS) ||
        comment === COMMENT_PADRE_ROUTER
    )
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

/** Cola PCQ del plan (`pcq_plan`): `argosisp-plan-<id>-pcq[-limitado]`. */
export function nombreColaPcq(planId: number, limitado: boolean): string {
    return `argosisp-plan-${planId}-pcq${limitado ? '-limitado' : ''}`
}

export function commentColaPcq(planId: number, limitado: boolean): string {
    return `${commentPlan(planId)}:pcq${limitado ? ':limitado' : ''}`
}

/** Tipo PCQ de la cola del plan: `argosisp-plan-<id>[-limitado]-pcq-<sentido>`. */
export function nombreTipoPcq(planId: number, limitado: boolean, sentido: Sentido): string {
    return `${listaPlan(planId, limitado)}-pcq-${sentido}`
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

/** Σ `limit-at` (kbps) de las colas dinámicas de cada padre. */
function limitAtDinamicas(lectura: LecturaVelocidad): Map<string, { subida: number; bajada: number }> {
    const salida = new Map<string, { subida: number; bajada: number }>()
    for (const cola of lectura.get('/queue/simple') ?? []) {
        if (cola.dynamic !== 'true' || !cola.parent || cola.parent === 'none') continue
        const suma = salida.get(cola.parent) ?? { subida: 0, bajada: 0 }
        const limitAt = kbpsPar(cola['limit-at'])
        suma.subida += limitAt.subida
        suma.bajada += limitAt.bajada
        salida.set(cola.parent, suma)
    }
    return salida
}

/** `limit-at` total de hijas > `max-limit` del padre, por sentido. */
function excede(
    hijas: { subida: number; bajada: number },
    padre: { subida: number; bajada: number },
): Array<'subida' | 'bajada'> {
    return (['subida', 'bajada'] as const).filter((d) => hijas[d] > padre[d])
}

/** Prefijos IPv6 de una lista de `target` (lo que lleva `:`). */
function prefijosV6(targets: string[]): string[] {
    return targets.filter((t) => t.includes(':'))
}

const dobles = (n: number) => `${n}/${n}`
const sumar = (a: { subida: number; bajada: number }, b: { subida: number; bajada: number }) => ({
    subida: a.subida + b.subida,
    bajada: a.bajada + b.bajada,
})

/**
 * Sin servicios que cuenten, el padre no garantiza nada: `limit-at = CIR × 0 = 0` (el `max-limit`
 * se sigue calculando con 1, porque 0 en RouterOS es "sin límite"). Así un plan vacío o un nodo
 * limitado sin limitados no ocupa garantía del enlace.
 */
function sinGarantiaVacio(limites: LimitesPadre, activos: number): LimitesPadre {
    if (activos > 0) return limites
    return { ...limites, limit_at: '0/0', limit_at_kbps: { subida: 0, bajada: 0 } }
}

/** Nombres de padres de ArgosIsp (`argosisp-plan-<id>`, `argosisp-router`) → clave de su cola. */
function comentarioDePadre(nombre: string): string | null {
    if (nombre === NOMBRE_PADRE_ROUTER) return COMMENT_PADRE_ROUTER
    const id = /^argosisp-plan-(\d+)$/.exec(nombre)?.[1]
    return id ? commentPlan(Number(id)) : null
}

export function estadoVelocidadRouter(
    router: RouterVelocidad,
    planes: PlanRouter[],
    lectura: LecturaVelocidad,
): EstadoVelocidad {
    const simple = estadoSimple(
        router,
        planes.filter((p) => p.familia === 'simple'),
        lectura,
    )
    const arbol = estadoArbol(
        router,
        planes.filter((p) => p.familia === 'arbol'),
        lectura,
    )
    // Los tipos de cola van antes que las colas que los usan; el árbol al final.
    const tipos = simple.presentes.filter((o) => o.ruta === '/queue/type')
    const resto = simple.presentes.filter((o) => o.ruta !== '/queue/type')
    // Sin RADIUS: perfiles `plan-<id>[-limitado]` de todo plan con PPPoE, después de las colas a las
    // que apuntan (`parent-queue`, `queue-type`).
    const locales =
        router.modo_seguridad === 'api'
            ? perfilesLocales(planes, perfilBase(lectura), new Set(simple.conservar))
            : { presentes: [], conservar: [] }
    return {
        presentes: [...tipos, ...resto, ...locales.presentes, ...arbol.presentes],
        avisos: [...simple.avisos, ...arbol.avisos],
        conservar: [...simple.conservar, ...arbol.conservar, ...locales.conservar],
        errores: [...simple.errores, ...arbol.errores],
    }
}

/** Familia de colas simples: tipos de hoja, PCQ por plan, padre del router, padres de plan, colas PCQ y perfiles. */
function estadoSimple(
    router: RouterVelocidad,
    planes: PlanRouter[],
    lectura: LecturaVelocidad,
): EstadoVelocidad {
    const tipos: ObjetoVelocidad[] = []
    const colasPlan: ObjetoVelocidad[] = []
    const colasPcq: ObjetoVelocidad[] = []
    const perfiles: ObjetoVelocidad[] = []
    const avisos: string[] = []
    const conservar: string[] = []
    const errores: ErrorReglaOro[] = []
    const dinamicas = hijasDinamicas(lectura)
    const limitAtDin = limitAtDinamicas(lectura)
    const base = perfilBase(lectura)

    // Tipos de cola de las hojas (sfq, fq_codel, cake).
    const hojas = new Set(planes.flatMap((p) => p.tipos_hoja))
    for (const tipo of [...hojas].sort()) {
        const nombre = nombreTipoHoja(tipo)
        const kind = kindTipoHoja(tipo)
        if (nombre && kind) {
            tipos.push({ ruta: '/queue/type', clave: { name: nombre }, propiedades: { kind } })
        }
    }

    // Hijas del padre del router: { targets, limit-at }.
    const delRouter = { targets: [] as string[], limitAt: { subida: 0, bajada: 0 }, hay: false }
    const sumarAlRouter = (targets: string[], limitAt: { subida: number; bajada: number }) => {
        delRouter.targets.push(...targets)
        delRouter.limitAt = sumar(delRouter.limitAt, limitAt)
    }

    // Planes con padre propio y planes que solo tienen sesiones viejas colgando.
    const conDinamicas = new Set(
        [...dinamicas.keys()]
            .map((nombre) => /^argosisp-plan-(\d+)$/.exec(nombre)?.[1])
            .filter((id): id is string => id !== undefined)
            .map(Number),
    )
    const porId = new Map(planes.map((p) => [p.plan_id, p]))

    for (const plan of [...planes].sort((a, b) => a.plan_id - b.plan_id)) {
        const id = plan.plan_id
        const e = plan.estrategia
        const vel = velocidadConExtras(plan.velocidad, e.extras)
        const nivelPlan = conNivelPlan(e, vel.reuso)
        if (
            conNivelRouter(e) ||
            (plan.pcq && conNivelRouter(plan.pcq.estrategia)) ||
            (plan.perfil && conNivelRouter(plan.perfil))
        ) {
            delRouter.hay = true
        }

        // Cola PCQ del plan: hija del padre del plan, del router o suelta.
        const pcqTargets: { targets: string[]; padre: string } = { targets: [], padre: 'none' }
        if (plan.pcq) {
            const ep = plan.pcq.estrategia
            const vp = velocidadConExtras(plan.velocidad, ep.extras)
            const padre = padreCliente(ep, id, vp.reuso)
            for (const limitado of [false, true]) {
                const v = limitado
                    ? {
                          ...vp,
                          bajada_kbps: vp.bajada_limitada_kbps,
                          subida_kbps: vp.subida_limitada_kbps,
                          rafaga_bajada_kbps: null,
                          rafaga_subida_kbps: null,
                      }
                    : vp
                for (const sentido of SENTIDOS) {
                    tipos.push({
                        ruta: '/queue/type',
                        clave: { name: nombreTipoPcq(id, limitado, sentido) },
                        propiedades: tipoPcq(v, sentido),
                    })
                }
                const targets = limitado ? plan.pcq.limitado : plan.pcq.activo
                pcqTargets.targets.push(...targets)
                colasPcq.push({
                    ruta: '/queue/simple',
                    clave: { comment: commentColaPcq(id, limitado) },
                    propiedades: {
                        name: nombreColaPcq(id, limitado),
                        target: targets.length > 0 ? targets.join(',') : TARGET_SIN_HIJAS,
                        queue: `${nombreTipoPcq(id, limitado, 'subida')}/${nombreTipoPcq(id, limitado, 'bajada')}`,
                        'max-limit': '0/0',
                        'limit-at': '0/0',
                        priority: dobles(v.prioridad),
                        parent: padre,
                        disabled: 'no',
                    },
                })
            }
            pcqTargets.padre = padre
            if (padre === NOMBRE_PADRE_ROUTER) sumarAlRouter(pcqTargets.targets, { subida: 0, bajada: 0 })
        }
        // Colas WISP que cuelgan directo del router.
        for (const h of plan.hijas) {
            if (h.padre === NOMBRE_PADRE_ROUTER) sumarAlRouter(h.targets, h.limit_at_kbps)
        }

        // Padre del plan.
        const nombre = nombrePadre(id)
        if (nivelPlan || conDinamicas.has(id)) {
            const hijasWisp = plan.hijas.filter((h) => h.padre === nombre)
            const targetsWisp = hijasWisp.flatMap((h) => h.targets)
            const pcqAqui = pcqTargets.padre === nombre ? pcqTargets.targets : []
            const targets = [...new Set([...targetsWisp, ...pcqAqui, ...(dinamicas.get(nombre) ?? [])])]
            if (!nivelPlan) {
                // Ya no lleva padre, pero hay sesiones viejas colgando: se conserva hasta que reconecten.
                avisos.push(`plan ${id}: sin padre en la estrategia vigente pero con sesiones bajo ${nombre}`)
                conservar.push(`/queue/simple|${claveTexto({ comment: commentPlan(id) })}`)
                conservar.push(`/ppp/profile|${claveTexto({ comment: commentPlan(id) })}`)
            } else {
                const limites = sinGarantiaVacio(limitesPadrePlan(vel, plan.activos), plan.activos)
                const hijas = sumar(
                    hijasWisp.reduce((t, h) => sumar(t, h.limit_at_kbps), { subida: 0, bajada: 0 }),
                    limitAtDin.get(nombre) ?? { subida: 0, bajada: 0 },
                )
                const sobre = excede(hijas, limites.max_limit_kbps)
                const faltanV6 = prefijosV6([...targetsWisp, ...(dinamicas.get(nombre) ?? [])]).filter(
                    (p) => !targets.includes(p),
                )
                if (sobre.length > 0 || faltanV6.length > 0) {
                    for (const d of sobre) {
                        errores.push({
                            plan_id: id,
                            regla: 'limit_at_hijos',
                            detalle:
                                `plan ${id}: la suma de limit-at de las hijas en ${d} (${hijas[d]} kbps) supera el ` +
                                `max-limit del padre ${nombre} (${limites.max_limit_kbps[d]} kbps)`,
                        })
                    }
                    if (faltanV6.length > 0) {
                        errores.push({
                            plan_id: id,
                            regla: 'ipv6',
                            detalle: `plan ${id}: el target del padre no incluye ${faltanV6.join(', ')}`,
                        })
                    }
                    conservar.push(`/queue/simple|${claveTexto({ comment: commentPlan(id) })}`)
                    conservar.push(`/ppp/profile|${claveTexto({ comment: commentPlan(id) })}`)
                    continue
                }
                const parent = e.padre === 'jerarquico' ? NOMBRE_PADRE_ROUTER : 'none'
                if (parent === NOMBRE_PADRE_ROUTER) sumarAlRouter(targets, limites.limit_at_kbps)
                colasPlan.push({
                    ruta: '/queue/simple',
                    clave: { comment: commentPlan(id) },
                    propiedades: {
                        name: nombre,
                        target: targets.length > 0 ? targets.join(',') : TARGET_SIN_HIJAS,
                        'max-limit': limites.max_limit,
                        'limit-at': limites.limit_at,
                        priority: dobles(limites.prioridad),
                        'burst-limit': '0/0',
                        'burst-threshold': '0/0',
                        'burst-time': '0s/0s',
                        parent,
                        disabled: 'no',
                    },
                })
            }
        }

        // Perfil PPP del plan (sin RADIUS los arma `perfilesLocales`, con su variante limitada).
        if (plan.perfil && router.modo_seguridad !== 'api') {
            const ep = plan.perfil
            const vp = velocidadConExtras(plan.velocidad, ep.extras)
            const padre = padreCliente(ep, id, vp.reuso)
            const tipo = nombreTipoHoja(ep.tipo_cola)
            perfiles.push({
                ruta: '/ppp/profile',
                clave: { comment: commentPlan(id) },
                propiedades: {
                    ...base,
                    name: nombrePerfil(id),
                    ...(padre !== 'none' ? { 'parent-queue': padre } : {}),
                    ...(tipo ? { 'queue-type': tipo } : {}),
                    ...(ep.aplicacion === 'perfil_ppp'
                        ? { 'rate-limit': rateLimitServicio(vp, 'activo') }
                        : {}),
                },
            })
        }
    }

    // Planes sin servicios en el router pero con sesiones colgando del padre: se conserva tal cual.
    for (const id of conDinamicas) {
        if (porId.has(id)) continue
        avisos.push(`plan ${id}: sin servicios en el router pero con sesiones bajo ${nombrePadre(id)}`)
        conservar.push(`/queue/simple|${claveTexto({ comment: commentPlan(id) })}`)
        conservar.push(`/ppp/profile|${claveTexto({ comment: commentPlan(id) })}`)
        delRouter.targets.push(...(dinamicas.get(nombrePadre(id)) ?? []))
    }

    // Padre del router (techo del enlace).
    const colasRouter: ObjetoVelocidad[] = []
    const dinRouter = dinamicas.get(NOMBRE_PADRE_ROUTER) ?? []
    if (delRouter.hay || dinRouter.length > 0) {
        const targets = [...new Set([...delRouter.targets, ...dinRouter])]
        const techo = { subida: router.capacidad_subida_kbps, bajada: router.capacidad_bajada_kbps }
        const hijas = sumar(
            delRouter.limitAt,
            limitAtDin.get(NOMBRE_PADRE_ROUTER) ?? { subida: 0, bajada: 0 },
        )
        const sobre = (['subida', 'bajada'] as const).filter((d) => techo[d] !== null && hijas[d] > techo[d]!)
        if (sobre.length > 0) {
            for (const d of sobre) {
                errores.push({
                    plan_id: null,
                    regla: 'limit_at_router',
                    detalle:
                        `la suma de limit-at bajo ${NOMBRE_PADRE_ROUTER} en ${d} (${hijas[d]} kbps) supera la ` +
                        `capacidad del enlace (${techo[d]} kbps)`,
                })
            }
            conservar.push(`/queue/simple|${claveTexto({ comment: COMMENT_PADRE_ROUTER })}`)
        } else if (!delRouter.hay) {
            avisos.push(
                `sin padre del router en la estrategia vigente pero con sesiones bajo ${NOMBRE_PADRE_ROUTER}`,
            )
            conservar.push(`/queue/simple|${claveTexto({ comment: COMMENT_PADRE_ROUTER })}`)
        } else {
            colasRouter.push({
                ruta: '/queue/simple',
                clave: { comment: COMMENT_PADRE_ROUTER },
                propiedades: {
                    name: NOMBRE_PADRE_ROUTER,
                    target: targets.length > 0 ? targets.join(',') : TARGET_SIN_HIJAS,
                    'max-limit': `${formatoKbps(techo.subida ?? 0)}/${formatoKbps(techo.bajada ?? 0)}`,
                    'limit-at': '0/0',
                    priority: '8/8',
                    'burst-limit': '0/0',
                    'burst-threshold': '0/0',
                    'burst-time': '0s/0s',
                    parent: 'none',
                    disabled: 'no',
                },
            })
        }
    }
    // Un plan con error de regla de oro no se escribe: si su padre cuelga del router, el router queda igual.
    return {
        presentes: [...dedupeTipos(tipos), ...colasRouter, ...colasPlan, ...colasPcq, ...perfiles],
        avisos,
        conservar,
        errores,
    }
}

function dedupeTipos(tipos: ObjetoVelocidad[]): ObjetoVelocidad[] {
    const vistos = new Set<string>()
    return tipos.filter((t) => {
        const k = claveTexto(t.clave)
        if (vistos.has(k)) return false
        vistos.add(k)
        return true
    })
}

/** Propiedades de un tipo PCQ por sentido, con ráfaga si la velocidad la trae. */
function tipoPcq(vel: VelocidadPlan, sentido: Sentido): Propiedades {
    const bajada = sentido === 'bajada'
    const mir = bajada ? vel.bajada_kbps : vel.subida_kbps
    const rafaga = bajada ? vel.rafaga_bajada_kbps : vel.rafaga_subida_kbps
    const props: Propiedades = {
        kind: 'pcq',
        'pcq-rate': formatoKbps(mir),
        'pcq-classifier': bajada ? 'dst-address' : 'src-address',
        ...(bajada ? { 'pcq-dst-address6-mask': '64' } : { 'pcq-src-address6-mask': '64' }),
    }
    if (rafaga !== null) {
        props['pcq-burst-rate'] = formatoKbps(rafaga)
        props['pcq-burst-threshold'] = formatoKbps(Math.floor((mir * vel.rafaga_umbral_pct) / 100))
        props['pcq-burst-time'] = `${vel.rafaga_segundos}s`
    }
    return props
}

/**
 * Familia árbol (`arbol_pcq`, `contratos/velocidad.md`, "Modo arbol_pcq"), en orden de creación:
 *
 * 1. `/queue/type` por plan y sentido: `argosisp-plan-<id>[-limitado]-<sentido>`, `kind = pcq`,
 *    `pcq-rate` = MIR (o el limitado), clasificador `dst-address` (bajada) / `src-address` (subida),
 *    máscara /64 en IPv6, y ráfaga PCQ si el extra está encendido.
 * 2. `/queue/tree` globales `argosisp-global-bajada|subida` (`parent = global`, `max-limit` =
 *    capacidad del enlace; 0 = sin techo), solo con padre `por_router` o `jerarquico`.
 * 3. `/queue/tree` por plan y sentido: hijos del global (o de `global` sin nivel de router). Con nivel
 *    de plan (`por_plan`, `jerarquico`) `max-limit` = `MIR × activos / reuso`; si no, 0 (el tope por
 *    cliente lo pone el PCQ). `limit-at` = CIR × activos con garantizado y un padre.
 * 4. Mangle IPv4 e IPv6 (`chain = forward`, `mark-packet`, `passthrough = no`).
 */
function estadoArbol(
    router: RouterVelocidad,
    planes: PlanRouter[],
    lectura: LecturaVelocidad,
): EstadoVelocidad {
    const tipos: ObjetoVelocidad[] = []
    const globales: ObjetoVelocidad[] = []
    const nodos: ObjetoVelocidad[] = []
    const mangles: ObjetoVelocidad[] = []
    // QoS por clases (`contratos/qos.md` §3): tipos con tope, hojas, cadenas por plan y clasificación.
    const qosTipos: ObjetoVelocidad[] = []
    const hojas: ObjetoVelocidad[] = []
    const qosMangles: ObjetoVelocidad[] = []
    const perfilQos = router.qos && claseResto(router.qos.clases) ? router.qos : null
    const capacidad = { bajada: router.capacidad_bajada_kbps, subida: router.capacidad_subida_kbps }
    // El techo existe si la estrategia del router lo pide (aunque no haya planes) o algún plan lo usa.
    const conGlobal =
        Object.values(router.estrategias).some(
            (e) => familia(e.aplicacion) === 'arbol' && conNivelRouter(e),
        ) || planes.some((p) => conNivelRouter(p.estrategia))
    if (conGlobal) {
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
    }
    for (const plan of [...planes].sort((a, b) => a.plan_id - b.plan_id)) {
        const e = plan.estrategia
        const base = velocidadConExtras(plan.velocidad, e.extras)
        const agrega = conNivelPlan(e, base.reuso)
        const conPadre = e.padre !== 'ninguno'
        const qos = perfilQos !== null && conQos(e)
        for (const limitado of [false, true]) {
            const vel = limitado
                ? {
                      ...base,
                      bajada_kbps: base.bajada_limitada_kbps,
                      subida_kbps: base.subida_limitada_kbps,
                      rafaga_bajada_kbps: null,
                      rafaga_subida_kbps: null,
                  }
                : base
            const cuenta = limitado ? plan.en_limitado : plan.en_activo
            const limites = sinGarantiaVacio(limitesPadrePlan(vel, cuenta), cuenta)
            const lista = listaPlan(plan.plan_id, limitado)
            for (const sentido of SENTIDOS) {
                const nombre = nombreNodo(plan.plan_id, limitado, sentido)
                const bajada = sentido === 'bajada'
                const pcq = tipoPcq(vel, sentido)
                tipos.push({
                    ruta: '/queue/type',
                    clave: { name: nombre },
                    propiedades: pcq,
                })
                if (qos) {
                    // El nodo del plan pasa a ser interno: las hojas por clase cuelgan de él.
                    const q = objetosQosPlan(perfilQos, {
                        nodo: nombre,
                        comment: commentNodo(plan.plan_id, limitado, sentido),
                        lista,
                        campoLista: bajada ? 'dst-address-list' : 'src-address-list',
                        capacidad_kbps: limites.max_limit_kbps[sentido],
                        clientes: cuenta,
                        garantizado: e.extras.garantizado,
                        pcq: { propiedades: pcq, mir_kbps: bajada ? vel.bajada_kbps : vel.subida_kbps },
                    })
                    qosTipos.push(...q.tipos)
                    hojas.push(...q.hojas)
                    qosMangles.push(...q.mangles)
                }
                nodos.push({
                    ruta: '/queue/tree',
                    clave: { comment: commentNodo(plan.plan_id, limitado, sentido) },
                    propiedades: {
                        name: nombre,
                        parent: conNivelRouter(e) ? nombreGlobal(sentido) : 'global',
                        'packet-mark': qos ? '' : nombre,
                        queue: nombre,
                        'max-limit': agrega ? formatoKbps(limites.max_limit_kbps[sentido]) : '0',
                        'limit-at': conPadre ? formatoKbps(limites.limit_at_kbps[sentido]) : '0',
                        priority: String(limites.prioridad),
                        disabled: 'no',
                    },
                })
                for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const) {
                    if (qos) continue
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
    // Regla de oro: Σ limit-at de los nodos de plan ≤ max-limit del global (capacidad del enlace).
    const errores: ErrorReglaOro[] = []
    for (const sentido of SENTIDOS) {
        const techo = capacidad[sentido]
        if (techo === null || !conGlobal) continue
        const suma = nodos
            .filter((n) => n.propiedades.parent === nombreGlobal(sentido))
            .reduce((total, n) => total + kbpsPar(n.propiedades['limit-at']).subida, 0)
        if (suma > techo) {
            errores.push({
                plan_id: null,
                regla: 'limit_at_global',
                detalle:
                    `la suma de limit-at de los planes en ${sentido} (${suma} kbps) supera la capacidad del ` +
                    `enlace (${techo} kbps, ${nombreGlobal(sentido)})`,
            })
        }
    }
    if (hojas.length > QOS_MAX_HOJAS) {
        errores.push({
            plan_id: null,
            regla: 'qos_costo',
            detalle:
                `el router pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${hojas.length}): apaga qos en los planes ` +
                'dedicados o usa menos clases',
        })
    }
    const clasificacion = perfilQos && hojas.length > 0 ? objetosClasificacion(perfilQos) : []
    const todos = [
        ...tipos,
        ...qosTipos,
        ...globales,
        ...nodos,
        ...hojas,
        ...mangles,
        ...clasificacion,
        ...qosMangles,
    ]
    if (errores.length > 0) {
        // Árbol inválido: no se escribe nada del árbol; lo que hay queda como está (también lo de QoS).
        const conservar = todos.map((o) => `${o.ruta}|${claveTexto(o.clave)}`)
        for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle', '/queue/tree'] as const) {
            for (const o of lectura.get(ruta) ?? []) {
                if (o.comment?.startsWith(PREFIJO_COMMENT_QOS) || o.comment?.includes(':qos')) {
                    conservar.push(`${ruta}|${claveTexto({ comment: o.comment })}`)
                }
            }
        }
        for (const o of lectura.get('/queue/type') ?? []) {
            if (/-q\d+$/.test(o.name ?? '')) conservar.push(`/queue/type|${claveTexto({ name: o.name! })}`)
        }
        // También los globales que existan aunque esta vez no hagan falta.
        for (const sentido of SENTIDOS) {
            conservar.push(`/queue/tree|${claveTexto({ comment: `${PREFIJO_COMMENT_GLOBAL}${sentido}` })}`)
        }
        return { presentes: [], avisos: [], conservar, errores }
    }
    return { presentes: todos, avisos: [], conservar: [], errores }
}

/** Orden de borrado dentro de un menú: hojas, después padres de plan, al final los del router/global. */
function profundidad(objeto: ObjetoRouterOS): number {
    const comment = objeto.comment ?? ''
    // Hojas de QoS antes que el nodo del plan del que cuelgan.
    if (/:qos:\d+$/.test(comment)) return -1
    if (comment === COMMENT_PADRE_ROUTER || comment.startsWith(PREFIJO_COMMENT_GLOBAL)) return 2
    if (/^argosisp:plan:\d+$/.test(comment)) return 1
    return 0
}

/**
 * Objetos de velocidad que hay en el router y no deben estar, en orden de borrado (perfiles antes
 * que la cola a la que apuntan, colas PCQ antes que el padre del plan y este antes que el del router).
 * Un padre que todavía tiene colas dinámicas colgando no se borra (`estadoVelocidadRouter` lo conserva).
 */
export function sobrantesVelocidad(
    estado: EstadoVelocidad,
    lectura: LecturaVelocidad,
): Array<{ ruta: MenuVelocidad; objeto: ObjetoRouterOS }> {
    const deseadas = new Set([
        ...estado.presentes.map((o) => `${o.ruta}|${claveTexto(o.clave)}`),
        ...estado.conservar,
    ])
    // Un padre de plan conservado mantiene también al padre del router del que cuelga.
    const simples = lectura.get('/queue/simple') ?? []
    for (const clave of [...deseadas]) {
        const comment = /^\/queue\/simple\|comment=(.+)$/.exec(clave)?.[1]
        const cola = comment ? simples.find((o) => o.comment === comment) : undefined
        const padre = cola?.parent ? comentarioDePadre(cola.parent) : null
        if (padre) deseadas.add(`/queue/simple|${claveTexto({ comment: padre })}`)
    }
    const salida: Array<{ ruta: MenuVelocidad; objeto: ObjetoRouterOS }> = []
    for (const ruta of MENUS_VELOCIDAD) {
        const sobran = (lectura.get(ruta) ?? []).filter((objeto) => {
            if (!esObjetoVelocidad(ruta, objeto)) return false
            const clave: Propiedades =
                ruta === '/queue/type' ? { name: objeto.name! } : { comment: objeto.comment! }
            return !deseadas.has(`${ruta}|${claveTexto(clave)}`)
        })
        for (const objeto of sobran.sort((a, b) => profundidad(a) - profundidad(b))) {
            salida.push({ ruta, objeto })
        }
    }
    return salida
}
