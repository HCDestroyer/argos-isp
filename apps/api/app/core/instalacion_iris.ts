import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema, ReglaNegocio } from '#shared/errores'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { obtenerImplementacionPlan, type PlanEfectivo } from '#network/actions/obtener_implementacion_plan'
import { leerServidorServicio } from '#network/red_acceso/servicio'
import { reconciliarAsignaciones, type Asignaciones } from '#core/asignaciones_servicio'
import type { ModoIpv6, TipoConexion } from '#core/consultas/servicios'

/**
 * Piezas comunes de «De la venta a la instalación» (contrato Iris 0.10.0 §3.4): alcance de Iris,
 * errores de §3.4.7, planes aplicables (A40) y la IP del pendiente (A38).
 */

/** Días que dura una reserva de IP en sitio sin activar (B5). */
export const DIAS_RESERVA_IP = 30

/** 422 `servicio_no_pendiente` (§3.4.7): A38 (reservar), A39, A40, A43. */
export class ServicioNoPendiente extends ReglaNegocio {
    constructor(estado: string) {
        super(
            `El servicio no está pendiente de instalación (está ${estado}): ya no se cambia por esta vía`,
            'servicio_no_pendiente',
        )
    }
}

/** 403 `servicio_no_de_iris` (§3.4, principio «Alcance»). */
export class ServicioNoDeIris extends Problema {
    constructor() {
        super(
            403,
            'servicio_no_de_iris',
            'El servicio no es de Iris',
            'Iris solo opera sobre servicios que creó o con una orden ya registrada para ese servicio',
        )
    }
}

/** 422 `sin_ip_disponible` (§3.4.1): sin IP o prefijo libre en el router. De negocio. */
export class SinIpDisponible extends ReglaNegocio {
    constructor(detalle = 'El router no tiene IPv4 o prefijos IPv6 libres para el servicio') {
        super(detalle, 'sin_ip_disponible')
    }
}

/** 422 `plan_no_permitido` (§3.4.5). */
export class PlanNoPermitido extends ReglaNegocio {
    constructor(
        detalle = 'El plan no es de los aplicables a este servicio (mismo modo y asignado al router)',
    ) {
        super(detalle, 'plan_no_permitido')
    }
}

const CODIGOS_SIN_IP = new Set(['sin_ipv4_libres', 'sin_prefijos_libres', 'sin_ipv4', 'sin_pool_ipv6'])

/** Corre `fn` traduciendo «sin IP o prefijo libre» del IPAM a `422 sin_ip_disponible`. */
export async function conSinIpDisponible<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (error) {
        if (error instanceof Problema) {
            const codigo = error.tipo.replace('urn:argosisp:problema:', '')
            if (CODIGOS_SIN_IP.has(codigo)) throw new SinIpDisponible(error.message)
        }
        throw error
    }
}

export interface OrigenIris {
    origen_tipo: string
    origen_id: string
}

/**
 * Alcance de §3.4 (con el token de Iris): el servicio es de Iris si su cliente tiene `codigo_externo`
 * `iris:*` o si Argos ya registró una orden de Iris para ese mismo servicio. Si no, 403
 * `servicio_no_de_iris`. Si lo es, registra esta orden (idempotente) para las llamadas siguientes.
 */
export async function exigirServicioDeIris(t: Transaccion, servicioId: number, origen: OrigenIris) {
    if (!(await esServicioDeIris(t.trx, servicioId))) throw new ServicioNoDeIris()
    await registrarOrigenIris(t.trx, servicioId, origen)
}

export async function esServicioDeIris(trx: TransactionClientContract, servicioId: number): Promise<boolean> {
    const fila = (await trx
        .from('core.servicios as s')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .where('s.id', servicioId)
        .select(
            trx.raw(`c.codigo_externo LIKE 'iris:%' AS de_iris`),
            trx.raw(
                'EXISTS (SELECT 1 FROM core.servicios_origenes_iris o WHERE o.servicio_id = s.id) AS con_orden',
            ),
        )
        .first()) as { de_iris: boolean | null; con_orden: boolean } | null
    return Boolean(fila?.de_iris) || Boolean(fila?.con_orden)
}

export async function registrarOrigenIris(
    trx: TransactionClientContract,
    servicioId: number,
    origen: OrigenIris,
): Promise<void> {
    await trx.rawQuery(
        `INSERT INTO core.servicios_origenes_iris (servicio_id, origen_tipo, origen_id) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [servicioId, origen.origen_tipo, origen.origen_id],
    )
}

// ── Planes aplicables (A40) ─────────────────────────────────────────────────────────────────

export const MODOS_PLAN = ['residencial', 'empresarial'] as const
export type ModoPlan = (typeof MODOS_PLAN)[number]

/** Modo del plan a partir de su tipo: `residencial`; `empresarial` y `dedicado` son empresariales. */
export function modoDeTipo(tipo: string): ModoPlan {
    return tipo === 'residencial' ? 'residencial' : 'empresarial'
}

/** SQL del modo de `network.planes as <alias>`. */
export function sqlModoPlan(alias = 'p'): string {
    return `(CASE WHEN ${alias}.tipo = 'residencial' THEN 'residencial' ELSE 'empresarial' END)`
}

/**
 * ¿`planId` es aplicable en `routerId` con el modo `modo`? Activo, del mismo modo y asignado a todos
 * los routers (`global`) o a ese router (`planes_routers`).
 */
export async function planAplicable(
    trx: TransactionClientContract,
    planId: number,
    routerId: number,
    modo: ModoPlan,
): Promise<boolean> {
    const fila = await trx
        .from('network.planes as p')
        .where('p.id', planId)
        .where('p.activo', true)
        .whereRaw(`${sqlModoPlan('p')} = ?`, [modo])
        .where((q) =>
            q
                .where('p.global', true)
                .orWhereExists((s) =>
                    s
                        .from('network.planes_routers as pr')
                        .whereRaw('pr.plan_id = p.id')
                        .where('pr.router_id', routerId),
                ),
        )
        .select('p.id')
        .first()
    return Boolean(fila)
}

/** ¿El plan está asignado a todos los routers o a ese router? (sin mirar `activo` ni el modo) */
export async function planDisponibleEnRouter(
    trx: TransactionClientContract,
    planId: number,
    routerId: number,
): Promise<boolean> {
    const fila = await trx
        .from('network.planes as p')
        .where('p.id', planId)
        .where((q) =>
            q
                .where('p.global', true)
                .orWhereExists((s) =>
                    s
                        .from('network.planes_routers as pr')
                        .whereRaw('pr.plan_id = p.id')
                        .where('pr.router_id', routerId),
                ),
        )
        .select('p.id')
        .first()
    return Boolean(fila)
}

/** Modo de un plan (para comparar el del servicio con el pedido). */
export async function modoDePlan(trx: TransactionClientContract, planId: number): Promise<ModoPlan> {
    const fila = (await trx.from('network.planes').where('id', planId).select('tipo').first()) as {
        tipo: string
    } | null
    return modoDeTipo(fila?.tipo ?? 'residencial')
}

// ── IP del pendiente (A38) ──────────────────────────────────────────────────────────────────

export interface FilaPendiente {
    id: number
    estado: EstadoServicioConPendiente
    router_id: number
    plan_id: number
    empresa_id: number
    tipo_conexion: TipoConexion
    ipv6_modo: ModoIpv6
    servidor_pppoe_id: number | null
    version: number
}

/** ¿El servicio tiene alguna asignación vigente (IPv4 o prefijo)? */
export async function tieneAsignaciones(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<boolean> {
    const fila = await trx
        .from('network.ipv4_asignaciones')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        .select('id')
        .unionAll((q) =>
            q
                .from('network.ipv6_asignaciones')
                .where('servicio_id', servicioId)
                .whereNull('fin')
                .select('id'),
        )
        .first()
    return Boolean(fila)
}

/**
 * Asigna IPv4 y prefijos IPv6 al servicio con su router y plan actuales (al reservar en sitio o al
 * activar un pendiente que no reservó). `422 sin_ip_disponible` si el router no tiene.
 */
export async function asignarIpPendiente(
    trx: TransactionClientContract,
    servicio: FilaPendiente,
    plan?: PlanEfectivo,
): Promise<Asignaciones> {
    const efectivo =
        plan ??
        (await obtenerImplementacionPlan(servicio.plan_id, servicio.router_id, trx, {
            aunqueNoDisponible: true,
        }))
    const servidor = await leerServidorServicio(trx, servicio.servidor_pppoe_id)
    return conSinIpDisponible(() =>
        reconciliarAsignaciones(trx, {
            servicioId: servicio.id,
            routerId: servicio.router_id,
            plan: efectivo,
            modo: servicio.ipv6_modo,
            tipoConexion: servicio.tipo_conexion,
            redIpv4Id: servidor?.red_ipv4_id ?? undefined,
            poolsV6: servidor
                ? { enlace: servidor.ipv6_pool_enlace_id, delegacion: servidor.ipv6_pool_delegacion_id }
                : undefined,
        }),
    )
}

/** Fila del servicio bloqueada para §3.4 (null si no existe). */
export async function bloquearServicio(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<FilaPendiente | null> {
    const fila = (await trx
        .from('core.servicios')
        .where('id', servicioId)
        .forUpdate()
        .select(
            'id',
            'estado',
            'router_id',
            'plan_id',
            'empresa_id',
            'tipo_conexion',
            'ipv6_modo',
            'servidor_pppoe_id',
            'version',
        )
        .first()) as FilaPendiente | null
    if (!fila) return null
    return {
        ...fila,
        id: Number(fila.id),
        router_id: Number(fila.router_id),
        plan_id: Number(fila.plan_id),
        empresa_id: Number(fila.empresa_id),
        servidor_pppoe_id: fila.servidor_pppoe_id === null ? null : Number(fila.servidor_pppoe_id),
        version: Number(fila.version),
    }
}
