import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { leerVelocidad, velocidadEfectiva } from '#network/velocidad'
import type { RouterApi } from '#network/routeros/router'
import type { RouterRed, ServicioRed, TipoConexion } from '#network/routeros/estado_deseado'
import { conPadreSimple, type PlanRouter, type RouterVelocidad } from '#network/routeros/velocidad_router'
import type { EstadoServicio } from '#shared/eventos'

/**
 * Lecturas del dispatcher de RouterOS. Todo sale de Postgres en el momento de aplicar (nunca del
 * payload del evento): así un evento viejo o repetido aplica el estado vigente.
 */

interface FilaServicio {
    servicio_id: number
    estado: EstadoServicio
    tipo_conexion: TipoConexion
    router_id: number
    plan_id: number
    ipv4: string | null
    prefijos_v6: string[] | null
    mac: string | null
    amarre_ip_mac: boolean
    [campo: string]: unknown
}

function consultaServicios(cliente: QueryClientContract) {
    return cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
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
    return {
        servicio_id: Number(fila.servicio_id),
        estado: fila.estado,
        tipo_conexion: fila.tipo_conexion,
        router_id: Number(fila.router_id),
        plan_id: Number(fila.plan_id),
        ipv4: fila.ipv4,
        prefijos_v6: fila.prefijos_v6 ?? [],
        mac: fila.mac,
        amarre_ip_mac: Boolean(fila.amarre_ip_mac),
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

/** Servicios sin PPPoE y no retirados de un router: lo que el reconciliador debe ver en él. */
export async function serviciosRedDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServicioRed[]> {
    const filas = (await consultaServicios(cliente)
        .where('s.router_id', routerId)
        .whereNot('s.tipo_conexion', 'pppoe')
        .whereNot('s.estado', 'retirado')
        .orderBy('s.id')) as FilaServicio[]
    return filas.map(aServicio)
}

/** Servicios no retirados de un router, de cualquier tipo (también PPPoE): base del control de velocidad. */
export async function serviciosVigentesDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServicioRed[]> {
    const filas = (await consultaServicios(cliente)
        .where('s.router_id', routerId)
        .whereNot('s.estado', 'retirado')
        .orderBy('s.id')) as FilaServicio[]
    return filas.map(aServicio)
}

/**
 * Planes con servicios vigentes en el router, para `estadoVelocidadRouter`: velocidad efectiva,
 * cuántos cuentan para el padre (ni suspendidos ni retirados) y los `target` de las colas WISP que
 * cuelgan de él. Las sesiones PPPoE no hacen falta: sus colas dinámicas se leen del router.
 */
export function planesDeRouter(router: RouterVelocidad, servicios: ServicioRed[]): PlanRouter[] {
    const planes = new Map<number, PlanRouter>()
    for (const s of servicios) {
        if (s.estado === 'retirado') continue
        let plan = planes.get(s.plan_id)
        if (!plan) {
            plan = { plan_id: s.plan_id, velocidad: s.velocidad, servicios: 0, activos: 0, targets_wisp: [] }
            planes.set(s.plan_id, plan)
        }
        plan.servicios++
        if (s.estado === 'suspendido') continue
        plan.activos++
        if (s.tipo_conexion !== 'pppoe' && s.ipv4 && conPadreSimple(router.control, s.velocidad)) {
            plan.targets_wisp.push(`${s.ipv4}/32`, ...s.prefijos_v6)
        }
    }
    return [...planes.values()].sort((a, b) => a.plan_id - b.plan_id)
}

/** ¿El router necesita objetos de velocidad (árbol, o algún plan con padre)? */
export function necesitaVelocidad(router: RouterVelocidad, planes: PlanRouter[]): boolean {
    return router.control === 'arbol_pcq' || planes.some((p) => conPadreSimple(router.control, p.velocidad))
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
        .from('audit.red')
        .where('servicio_id', servicioId)
        .where('tipo', 'routeros')
        .whereNotNull('router_id')
        .distinct('router_id')) as Array<{ router_id: number }>
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

/**
 * Router con lo necesario para su API REST. Los campos opcionales (`api_url`, `api_tls_verificar`,
 * `api_ca`, `dhcp_servidor`, `interfaz_clientes`) se leen si el modelo los tiene (pedidos a A1 en
 * `.claude/integration/a2.md`); si no, valen los del entorno (`ROUTEROS_*`).
 */
export async function routerDispatcher(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
    predeterminados: PredeterminadosRed = {},
): Promise<RouterDispatcher | null> {
    const fila = (await cliente
        .from('network.routers as r')
        .where('r.id', routerId)
        .select(cliente.raw('to_jsonb(r) AS r'))
        .first()) as { r: Record<string, unknown> } | null
    if (!fila) return null
    const r = fila.r
    const texto = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
    const kbps = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        activo: r.activo !== false,
        nombre: String(r.nombre ?? r.id),
        api: {
            id: Number(r.id),
            host: String(r.host),
            api_usuario: texto(r.api_usuario),
            api_password: texto(r.api_password),
            api_url: texto(r.api_url),
            api_tls_verificar: typeof r.api_tls_verificar === 'boolean' ? r.api_tls_verificar : null,
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
            control_velocidad: r.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
        },
        velocidad: {
            router_id: Number(r.id),
            control: r.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
            capacidad_bajada_kbps: kbps(r.capacidad_bajada_kbps),
            capacidad_subida_kbps: kbps(r.capacidad_subida_kbps),
        },
        con_credenciales: texto(r.api_usuario) !== null && texto(r.api_password) !== null,
    }
}
