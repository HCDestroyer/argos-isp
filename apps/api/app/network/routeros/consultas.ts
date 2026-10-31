import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import {
    leerVelocidad,
    rateLimitServicio,
    velocidadEfectiva,
    type ControlVelocidad,
} from '#network/velocidad'
import {
    conNivelPlan,
    familia,
    necesitaPerfil,
    padreCliente,
    velocidadConExtras,
    type Estrategia,
    controlDerivado,
    estrategiaDeCopia,
    estrategiaEfectiva,
    estrategiasDeFila,
    leerEstrategias,
    leerExcepcion,
} from '#network/estrategia_velocidad'
import type { RouterApi } from '#network/routeros/router'
import {
    propiedadesCola,
    type RouterRed,
    type ServicioRed,
    type TipoConexion,
} from '#network/routeros/estado_deseado'
import {
    estadoVelocidadRouter,
    kbpsPar,
    type PlanRouter,
    type RouterVelocidad,
} from '#network/routeros/velocidad_router'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { estrategiaLocal } from '#network/routeros/pppoe_local'
import { perfilQosRouter } from '#network/consultas/qos'

/**
 * Lecturas del dispatcher de RouterOS. Todo sale de Postgres en el momento de aplicar (nunca del
 * payload del evento): así un evento viejo o repetido aplica el estado vigente.
 */

interface FilaServicio {
    servicio_id: number
    estado: EstadoServicioConPendiente
    tipo_conexion: TipoConexion
    router_id: number
    plan_id: number
    ipv4: string | null
    prefijos_v6: string[] | null
    mac: string | null
    amarre_ip_mac: boolean
    sesion: {
        ipv4: string | null
        enlace: string | null
        delegado: string | null
        inicio?: string
        estrategia?: unknown
    } | null
    [campo: string]: unknown
}

function consultaServicios(cliente: QueryClientContract) {
    return cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .join('network.routers as r', 'r.id', 's.router_id')
        .leftJoin('network.planes_routers as pr', (j) =>
            j.on('pr.plan_id', '=', 's.plan_id').andOn('pr.router_id', '=', 's.router_id'),
        )
        .select(
            's.id as servicio_id',
            's.estado',
            's.tipo_conexion',
            's.router_id',
            's.plan_id',
            cliente.raw('upper(s.mac::text) AS mac'),
            's.amarre_ip_mac',
            'p.bajada_kbps',
            'p.subida_kbps',
            'p.bajada_limitada_kbps',
            'p.subida_limitada_kbps',
            'p.reuso',
            cliente.raw('p.garantizado_pct::float8 AS garantizado_pct'),
            'p.rafaga_bajada_kbps',
            'p.rafaga_subida_kbps',
            'p.rafaga_umbral_pct',
            'p.rafaga_segundos',
            'p.prioridad',
            'pr.rate_limit_override',
            'pr.reuso as pr_reuso',
            cliente.raw('pr.garantizado_pct::float8 AS pr_garantizado_pct'),
            'pr.rafaga_bajada_kbps as pr_rafaga_bajada_kbps',
            'pr.rafaga_subida_kbps as pr_rafaga_subida_kbps',
            'pr.rafaga_umbral_pct as pr_rafaga_umbral_pct',
            'pr.rafaga_segundos as pr_rafaga_segundos',
            'pr.prioridad as pr_prioridad',
            'r.control_velocidad',
            'r.estrategia_velocidad',
            'r.modo_seguridad',
            'pr.estrategia_velocidad as pr_estrategia_velocidad',
            // PPPoE sin RADIUS (contratos/pppoe-local.md): secret y pools del perfil del plan.
            's.user_ppp',
            's.pass_ppp',
            'pr.pool_ipv4',
            'pr.pool_ipv6_enlace',
            'pr.pool_ipv6_delegacion',
            cliente.raw(
                `(SELECT a.prefijo::text FROM network.ipv6_asignaciones a
                   WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'enlace'
                     AND s.ipv6_modo = 'radius_servicio' ORDER BY a.id DESC LIMIT 1) AS prefijo_enlace`,
            ),
            cliente.raw(
                `(SELECT host(a.ip) FROM network.ipv4_asignaciones a
                   WHERE a.servicio_id = s.id AND a.fin IS NULL ORDER BY a.id DESC LIMIT 1) AS ipv4`,
            ),
            cliente.raw(
                // Solo el prefijo delegado (propio del servicio): el /64 de enlace de WISP es el del
                // segmento, compartido con RA (`infra/mikrotik/README.md`), y no va en la cola.
                `ARRAY(SELECT a.prefijo::text FROM network.ipv6_asignaciones a
                        WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'delegacion') AS prefijos_v6`,
            ),
            cliente.raw(
                // Sesión PPPoE abierta más reciente: sus direcciones van a las listas del árbol.
                `(SELECT jsonb_build_object('ipv4', host(ses.ipv4), 'enlace', ses.prefijo_enlace_v6::text,
                                            'delegado', ses.prefijo_delegado_v6::text,
                                            'inicio', ses.inicio,
                                            'estrategia', ses.estrategia_velocidad)
                    FROM network.sesiones ses
                   WHERE ses.servicio_id = s.id AND ses.fin IS NULL
                   ORDER BY ses.inicio DESC, ses.id DESC LIMIT 1) AS sesion`,
            ),
        )
}

/** Estrategias del router y excepción del plan en él, de una fila con esas columnas. */
export function estrategiaDeFila(fila: Record<string, unknown>, tipo: TipoConexion): Estrategia {
    const control: ControlVelocidad = fila.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple'
    return estrategiaEfectiva(
        estrategiasDeFila(fila.estrategia_velocidad, control),
        leerExcepcion(fila.pr_estrategia_velocidad),
        tipo,
    )
}

function aServicio(fila: FilaServicio): ServicioRed {
    const plan = leerVelocidad(fila)
    const excepcion = {
        reuso: fila.pr_reuso as number | null,
        garantizado_pct: fila.pr_garantizado_pct as number | null,
        rafaga_bajada_kbps: fila.pr_rafaga_bajada_kbps as number | null,
        rafaga_subida_kbps: fila.pr_rafaga_subida_kbps as number | null,
        rafaga_umbral_pct: fila.pr_rafaga_umbral_pct as number | null,
        rafaga_segundos: fila.pr_rafaga_segundos as number | null,
        prioridad: fila.pr_prioridad as number | null,
    }
    // Router sin RADIUS: PPPoE va por perfil (`radius_rate_limit` → `perfil_ppp`, pppoe-local.md §5).
    const local = fila.modo_seguridad === 'api'
    const ppp = (e: Estrategia) => (local ? estrategiaLocal(e) : e)
    const estrategia =
        fila.tipo_conexion === 'pppoe'
            ? ppp(estrategiaDeFila(fila, 'pppoe'))
            : estrategiaDeFila(fila, fila.tipo_conexion)
    const texto = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
    return {
        servicio_id: Number(fila.servicio_id),
        estado: fila.estado,
        estrategia,
        estrategia_pppoe: ppp(estrategiaDeFila(fila, 'pppoe')),
        // Una sesión PPPoE conserva la estrategia con la que entró hasta reconectar (control-velocidad.md §4).
        estrategia_sesion:
            fila.tipo_conexion === 'pppoe' && fila.sesion
                ? ppp(estrategiaDeCopia(fila.sesion.estrategia) ?? estrategia)
                : null,
        user_ppp: texto(fila.user_ppp),
        pass_ppp: texto(fila.pass_ppp),
        prefijo_enlace: texto(fila.prefijo_enlace),
        pools: {
            ipv4: texto(fila.pool_ipv4),
            enlace: texto(fila.pool_ipv6_enlace),
            delegado: texto(fila.pool_ipv6_delegacion),
        },
        tipo_conexion: fila.tipo_conexion,
        router_id: Number(fila.router_id),
        plan_id: Number(fila.plan_id),
        ipv4: fila.ipv4,
        prefijos_v6: fila.prefijos_v6 ?? [],
        mac: fila.mac,
        amarre_ip_mac: Boolean(fila.amarre_ip_mac),
        sesion: fila.sesion
            ? { ipv4: fila.sesion.ipv4, enlace: fila.sesion.enlace, delegado: fila.sesion.delegado }
            : null,
        velocidad: velocidadEfectiva(plan, excepcion),
    }
}

/** El servicio con su velocidad efectiva, o null si no existe. */
export async function servicioRed(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServicioRed | null> {
    const fila = (await consultaServicios(cliente).where('s.id', servicioId).first()) as FilaServicio | null
    return fila ? aServicio(fila) : null
}

/**
 * Estados que no tienen nada en el router: retirado y pendiente de instalación
 * (`contratos/instalacion.md` §3). El reconciliador borra lo que encuentre de ellos (huérfanos).
 */
export const ESTADOS_SIN_RED = ['retirado', 'pendiente_instalacion'] as const

/** Servicios sin PPPoE, no retirados ni pendientes, de un router: lo que el reconciliador debe ver en él. */
export async function serviciosRedDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServicioRed[]> {
    const filas = (await consultaServicios(cliente)
        .where('s.router_id', routerId)
        .whereNot('s.tipo_conexion', 'pppoe')
        .whereNotIn('s.estado', [...ESTADOS_SIN_RED])
        .orderBy('s.id')) as FilaServicio[]
    return filas.map(aServicio)
}

/**
 * Servicios no retirados ni pendientes de instalación de un router, de cualquier tipo (también
 * PPPoE): base del control de velocidad. Un pendiente no cuenta para el padre del plan ni crea el
 * perfil `plan-<id>` hasta que se activa.
 */
export async function serviciosVigentesDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServicioRed[]> {
    const filas = (await consultaServicios(cliente)
        .where('s.router_id', routerId)
        .whereNotIn('s.estado', [...ESTADOS_SIN_RED])
        .orderBy('s.id')) as FilaServicio[]
    return filas.map(aServicio)
}

/** Estrategia con la que está limitado hoy un servicio: la de su sesión PPPoE abierta, o la vigente. */
export function estrategiaVigente(s: ServicioRed): Estrategia {
    return s.tipo_conexion === 'pppoe' && s.estrategia_sesion ? s.estrategia_sesion : s.estrategia
}

/** Targets de un servicio en una cola: IPv4 y prefijo delegado (WISP) o las direcciones de la sesión (PPPoE). */
function targetsServicio(s: ServicioRed): string[] {
    if (s.tipo_conexion === 'pppoe') {
        if (!s.sesion) return []
        return [s.sesion.ipv4 ? `${s.sesion.ipv4}/32` : null, s.sesion.enlace, s.sesion.delegado].filter(
            (t): t is string => t !== null,
        )
    }
    return s.ipv4 ? [`${s.ipv4}/32`, ...s.prefijos_v6] : []
}

/**
 * Grupos (plan × familia de colas) con servicios vigentes en el router, para `estadoVelocidadRouter`:
 * velocidad efectiva, cuántos cuentan para el padre, colas WISP hijas, clientes de la cola PCQ y el
 * perfil PPP que necesita el plan.
 *
 * Cada servicio cuenta en el grupo de la estrategia con la que está limitado hoy (`estrategiaVigente`:
 * una sesión PPPoE de antes del último cambio, la anterior), y además hace existir el grupo de su
 * estrategia vigente: lo nuevo se crea antes de que reconecte (`contratos/control-velocidad.md` §4).
 * Las sesiones PPPoE no hacen falta para las colas dinámicas: se leen del router.
 */
export function planesDeRouter(router: RouterVelocidad, servicios: ServicioRed[]): PlanRouter[] {
    const local = router.modo_seguridad === 'api'
    const grupos = new Map<string, PlanRouter>()
    const grupo = (s: ServicioRed, e: Estrategia): PlanRouter => {
        const fam = familia(e.aplicacion)
        const clave = `${s.plan_id}|${fam}`
        let g = grupos.get(clave)
        if (!g) {
            g = {
                plan_id: s.plan_id,
                familia: fam,
                velocidad: s.velocidad,
                estrategia: e,
                servicios: 0,
                activos: 0,
                en_activo: 0,
                en_limitado: 0,
                hijas: [],
                pcq: null,
                perfil: null,
                tipos_hoja: [],
            }
            grupos.set(clave, g)
        }
        // Representa al grupo lo que cuelga de un padre (padre y extras iguales por la regla 6).
        if (g.estrategia.padre === 'ninguno' && e.padre !== 'ninguno' && e.aplicacion !== 'pcq_plan') {
            g.estrategia = e
        }
        if (e.tipo_cola !== 'default' && e.tipo_cola !== 'pcq' && !g.tipos_hoja.includes(e.tipo_cola)) {
            g.tipos_hoja.push(e.tipo_cola)
        }
        if (e.aplicacion === 'pcq_plan' && !g.pcq) g.pcq = { estrategia: e, activo: [], limitado: [] }
        return g
    }
    for (const s of servicios) {
        if (s.estado === 'retirado' || s.estado === 'pendiente_instalacion') continue
        const actual = s.estrategia
        const vigente = estrategiaVigente(s)
        grupo(s, actual)
        // El perfil `plan-<id>` lo pide la estrategia PPPoE del plan en el router (aunque el plan aún no
        // tenga servicios PPPoE, como hasta ahora); si ya no lo necesita, el de las sesiones viejas.
        let nuevo: PlanRouter | null = null
        if (necesitaPerfil(s.estrategia_pppoe, s.plan_id, s.velocidad.reuso)) {
            nuevo = grupo(s, s.estrategia_pppoe)
            nuevo.perfil = s.estrategia_pppoe
        }
        const g = grupo(s, vigente)
        if (
            s.tipo_conexion === 'pppoe' &&
            !g.perfil &&
            !nuevo?.perfil &&
            necesitaPerfil(vigente, s.plan_id, s.velocidad.reuso)
        ) {
            g.perfil = vigente
        }
        // Sin RADIUS todo plan con PPPoE necesita sus perfiles (`plan-<id>[-limitado]`): el secret
        // apunta a ellos, también en el árbol (`address-list` del plan). Pools: los del plan.
        if (local && s.tipo_conexion === 'pppoe') {
            if (!g.perfil && !nuevo?.perfil) g.perfil = vigente
            const p = nuevo?.perfil ? nuevo : g
            if (!p.pools && s.pools && (s.pools.ipv4 || s.pools.enlace || s.pools.delegado)) {
                p.pools = s.pools
            }
        }
        g.servicios++
        if (s.estado === 'suspendido') continue
        const vel = velocidadConExtras(s.velocidad, vigente.extras)
        if (g.familia === 'arbol') {
            g.activos++
            if (s.estado === 'limitado') g.en_limitado++
            else g.en_activo++
            continue
        }
        if (conNivelPlan(vigente, vel.reuso)) g.activos++
        if (vigente.aplicacion === 'pcq_plan') {
            const pcq = g.pcq ?? (g.pcq = { estrategia: vigente, activo: [], limitado: [] })
            pcq[s.estado === 'limitado' ? 'limitado' : 'activo'].push(...targetsServicio(s))
            continue
        }
        if (vigente.aplicacion !== 'cola_simple' || !s.ipv4) continue
        const padre = padreCliente(vigente, s.plan_id, vel.reuso)
        if (padre === 'none') continue
        // `limit-at` de la cola WISP (el mismo que arma `estado_deseado.ts`), para la regla de oro.
        const limitAt = kbpsPar(propiedadesCola(rateLimitServicio(vel, s.estado))['limit-at']!)
        let hijas = g.hijas.find((h) => h.padre === padre)
        if (!hijas) {
            hijas = { padre, targets: [], limit_at_kbps: { subida: 0, bajada: 0 } }
            g.hijas.push(hijas)
        }
        hijas.targets.push(...targetsServicio(s))
        hijas.limit_at_kbps.subida += limitAt.subida
        hijas.limit_at_kbps.bajada += limitAt.bajada
    }
    return [...grupos.values()].sort((a, b) => a.plan_id - b.plan_id || a.familia.localeCompare(b.familia))
}

/** ¿El router necesita objetos de velocidad (árbol, padres, colas PCQ, perfiles o tipos de cola)? */
export function necesitaVelocidad(router: RouterVelocidad, planes: PlanRouter[]): boolean {
    const estado = estadoVelocidadRouter(router, planes, new Map())
    return estado.presentes.length > 0 || estado.conservar.length > 0 || estado.errores.length > 0
}

/**
 * Routers donde el dispatcher escribió alguna vez para el servicio (`audit.red`, tipo `routeros`):
 * al cambiar de router o de tipo, ahí puede quedar algo que limpiar.
 */
export async function routersConHistorial(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<number[]> {
    const filas = (await cliente
        .from('audit.red as a')
        .join('network.routers as r', 'r.id', 'a.router_id')
        .where('a.servicio_id', servicioId)
        .where('a.tipo', 'routeros')
        // un router unido a otro (`routers.unir`) es el mismo equipo que el que queda: limpiar en él
        // borraría lo que el router actual acaba de crear (`contratos/routers.md`)
        .whereNull('r.unido_a_id')
        .distinct('a.router_id')) as Array<{ router_id: number }>
    return filas.map((f) => Number(f.router_id))
}

/**
 * Routers activos que se reconcilian: los que tienen servicios sin PPPoE y los que ArgosIsp
 * administra por la API (con credenciales y servicios: control de velocidad, perfiles PPP, árbol).
 * Con `planId`, solo los que tienen servicios de ese plan.
 */
export async function routersConServiciosSinPppoe(
    opciones: { planId?: number } = {},
    cliente: QueryClientContract = db.connection(),
): Promise<number[]> {
    const consulta = cliente
        .from('core.servicios as s')
        .join('network.routers as r', 'r.id', 's.router_id')
        .where('r.activo', true)
        .where((q) =>
            q
                .whereNot('s.tipo_conexion', 'pppoe')
                .orWhere((c) => c.whereNotNull('r.api_usuario').whereNotNull('r.api_password')),
        )
        .distinct('s.router_id')
    if (opciones.planId) consulta.where('s.plan_id', opciones.planId)
    const filas = (await consulta) as Array<{ router_id: number }>
    return filas.map((f) => Number(f.router_id)).sort((a, b) => a - b)
}

/**
 * Routers que se sondean por `/ppp/active` (`contratos/pppoe-local.md` §6): activos, con credenciales
 * de la API y sin RADIUS, más los que pasaron a RADIUS con sesiones de sondeo todavía abiertas.
 */
export async function routersConSesionesPpp(
    cliente: QueryClientContract = db.connection(),
): Promise<number[]> {
    const filas = (await cliente
        .from('network.routers as r')
        .where('r.activo', true)
        .whereNotNull('r.api_usuario')
        .whereNotNull('r.api_password')
        .where((q) =>
            q
                .where('r.modo_seguridad', 'api')
                .orWhereExists((e) =>
                    e
                        .from('network.sesiones as ses')
                        .whereRaw('ses.router_id = r.id')
                        .where('ses.origen', 'sondeo')
                        .whereNull('ses.fin'),
                ),
        )
        .orderBy('r.id')
        .select('r.id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

/** Valores para routers que no definen `dhcp_servidor` / `interfaz_clientes` (antes que el entorno). */
export interface PredeterminadosRed {
    dhcp_servidor?: string
    interfaz_clientes?: string
}

export interface RouterDispatcher {
    nombre: string
    api: RouterApi
    red: RouterRed
    velocidad: RouterVelocidad
    /** Tiene `api_usuario` y `api_password`: ArgosIsp puede administrarlo por la API REST */
    con_credenciales: boolean
    activo: boolean
}

interface FilaRouterDispatcher {
    id: number | string
    nombre: string
    activo: boolean
    host: string
    api_usuario: string | null
    api_password: string | null
    api_url: string | null
    api_tls_verificar: boolean
    api_ca: string | null
    dhcp_servidor: string | null
    interfaz_clientes: string | null
    control_velocidad: string
    estrategia_velocidad: unknown
    routeros_version: string | null
    capacidad_bajada_kbps: number | null
    capacidad_subida_kbps: number | null
    qos_perfil_id: number | string | null
    modo_seguridad: 'radius' | 'api'
}

/**
 * Router con lo necesario para su API REST y su red (columnas de `network.routers`, contrato en
 * `contratos/routeros.md`, "Conexión del router"). Precedencia de `dhcp_servidor` e
 * `interfaz_clientes`: columna del router → `predeterminados` del llamador → `ROUTEROS_*` del entorno →
 * `all` / sin ARP. La verificación TLS es solo la del router (`api_tls_verificar`, NOT NULL).
 */
export async function routerDispatcher(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
    predeterminados: PredeterminadosRed = {},
): Promise<RouterDispatcher | null> {
    const r = (await cliente
        .from('network.routers as r')
        .where('r.id', routerId)
        .select(
            'r.id',
            'r.nombre',
            'r.activo',
            'r.host',
            'r.api_usuario',
            'r.api_password',
            'r.api_url',
            'r.api_tls_verificar',
            'r.api_ca',
            'r.dhcp_servidor',
            'r.interfaz_clientes',
            'r.control_velocidad',
            'r.estrategia_velocidad',
            'r.routeros_version',
            'r.capacidad_bajada_kbps',
            'r.capacidad_subida_kbps',
            'r.qos_perfil_id',
            'r.modo_seguridad',
        )
        .first()) as FilaRouterDispatcher | null
    if (!r) return null
    const texto = (v: string | null) => (v !== null && v !== '' ? v : null)
    const kbps = (v: number | null) => (v === null ? null : Number(v))
    const estrategias = estrategiasDeFila(
        r.estrategia_velocidad,
        r.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
    )
    const control = controlDerivado(estrategias)
    return {
        activo: r.activo,
        nombre: r.nombre,
        api: {
            id: Number(r.id),
            host: r.host,
            api_usuario: texto(r.api_usuario),
            api_password: texto(r.api_password),
            api_url: texto(r.api_url),
            api_tls_verificar: r.api_tls_verificar,
            api_ca: texto(r.api_ca),
        },
        red: {
            router_id: Number(r.id),
            dhcp_servidor:
                texto(r.dhcp_servidor) ??
                predeterminados.dhcp_servidor ??
                env.get('ROUTEROS_DHCP_SERVIDOR') ??
                'all',
            interfaz_clientes:
                texto(r.interfaz_clientes) ??
                predeterminados.interfaz_clientes ??
                env.get('ROUTEROS_INTERFAZ_CLIENTES') ??
                null,
            control_velocidad: control,
            modo_seguridad: r.modo_seguridad,
        },
        velocidad: {
            router_id: Number(r.id),
            modo_seguridad: r.modo_seguridad,
            control,
            estrategias,
            routeros_version: texto(r.routeros_version),
            capacidad_bajada_kbps: kbps(r.capacidad_bajada_kbps),
            capacidad_subida_kbps: kbps(r.capacidad_subida_kbps),
            qos: await perfilQosRouter(r.qos_perfil_id === null ? null : Number(r.qos_perfil_id), cliente),
        },
        con_credenciales: texto(r.api_usuario) !== null && texto(r.api_password) !== null,
    }
}

/** Redes IPv4 de clientes del router (`argos-clientes`, exclusión de FastTrack). */
export async function redesV4DeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<string[]> {
    const filas = (await cliente
        .from('network.redes_ipv4')
        .where('router_id', routerId)
        .orderBy('id')
        .select(cliente.raw('cidr::text AS cidr'))) as Array<{ cidr: string }>
    return filas.map((f) => f.cidr)
}

/** Estrategias en uso en el router: las suyas por tipo y las efectivas de sus servicios. */
export function estrategiasEnUso(router: RouterVelocidad, servicios: ServicioRed[]): Estrategia[] {
    return [...Object.values(router.estrategias), ...servicios.map((s) => s.estrategia)]
}

/**
 * Firma de la estrategia vigente de un router (o de la excepción de un plan en él): la lleva el job
 * del cambio para saber si otro cambio posterior lo superó. Misma forma que `firmaDeEvento`.
 */
export async function firmaEstrategia(
    routerId: number,
    planId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<string> {
    if (planId === null) {
        const r = (await cliente
            .from('network.routers')
            .where('id', routerId)
            .select('estrategia_velocidad', 'control_velocidad')
            .first()) as { estrategia_velocidad: unknown; control_velocidad: string } | null
        return JSON.stringify(
            r
                ? estrategiasDeFila(
                      r.estrategia_velocidad,
                      r.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
                  )
                : null,
        )
    }
    const pr = (await cliente
        .from('network.planes_routers')
        .where('router_id', routerId)
        .where('plan_id', planId)
        .select('estrategia_velocidad')
        .first()) as { estrategia_velocidad: unknown } | null
    return JSON.stringify(leerExcepcion(pr?.estrategia_velocidad))
}

/** Firma del destino de un `router.estrategia_cambiada` (comparable con `firmaEstrategia`). */
export function firmaDeEvento(planId: number | null, a: unknown): string {
    return JSON.stringify(planId === null ? leerEstrategias(a) : leerExcepcion(a))
}
