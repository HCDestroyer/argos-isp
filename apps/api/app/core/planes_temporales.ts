import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { registrarTramo } from '#network/historial'

/**
 * Planes temporales de un servicio (`contratos/lealtad.md` §3 y §5, `mejora_plan`).
 *
 * Mientras uno está `activo`, `core.servicios.plan_id` es el plan temporal: RADIUS (`aaa:user:*`),
 * RouterOS y la facturación lo leen como cualquier plan, sin código propio. `plan_original_id`
 * guarda el plan base al que vuelve el servicio al terminar o cancelar (solo cambia el plan; IPs y
 * prefijos se quedan, por eso el plan temporal debe ser compatible, ver `exigirPlanCompatible`).
 */

export const ESTADOS_PLAN_TEMPORAL = ['programado', 'activo', 'terminado', 'cancelado'] as const
export type EstadoPlanTemporal = (typeof ESTADOS_PLAN_TEMPORAL)[number]
export const ORIGENES_PLAN_TEMPORAL = ['lealtad', 'manual'] as const
export type OrigenPlanTemporal = (typeof ORIGENES_PLAN_TEMPORAL)[number]

export interface PlanTemporalVista {
    id: number
    empresa_id: number
    servicio_id: number
    plan_id: number
    plan_nombre: string
    plan_original_id: number
    plan_original_nombre: string
    inicio: string
    fin: string
    origen: OrigenPlanTemporal
    origen_id: number | null
    estado: EstadoPlanTemporal
    motivo: string | null
    iniciado_en: string | null
    terminado_en: string | null
    creado_por: number | null
    version: number
    created_at: string
    updated_at: string
}

/** Fila cruda (para bloquear y decidir dentro de una acción). */
export interface FilaPlanTemporal {
    id: number
    empresa_id: number
    servicio_id: number
    plan_id: number
    plan_original_id: number
    inicio: Date
    fin: Date
    estado: EstadoPlanTemporal
    version: number
}

function columnasVista(cliente: QueryClientContract) {
    return [
        't.id',
        't.empresa_id',
        't.servicio_id',
        't.plan_id',
        cliente.raw('(SELECT p.nombre FROM network.planes p WHERE p.id = t.plan_id) AS plan_nombre'),
        't.plan_original_id',
        cliente.raw(
            '(SELECT p.nombre FROM network.planes p WHERE p.id = t.plan_original_id) AS plan_original_nombre',
        ),
        't.inicio',
        't.fin',
        't.origen',
        't.origen_id',
        't.estado',
        't.motivo',
        't.iniciado_en',
        't.terminado_en',
        't.creado_por',
        't.version',
        't.created_at',
        't.updated_at',
    ]
}

function normalizarVista(fila: Record<string, unknown>): PlanTemporalVista {
    const instante = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null))
    return {
        ...(fila as unknown as PlanTemporalVista),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        servicio_id: Number(fila.servicio_id),
        plan_id: Number(fila.plan_id),
        plan_original_id: Number(fila.plan_original_id),
        origen_id: fila.origen_id === null ? null : Number(fila.origen_id),
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
        inicio: instante(fila.inicio)!,
        fin: instante(fila.fin)!,
        iniciado_en: instante(fila.iniciado_en),
        terminado_en: instante(fila.terminado_en),
        created_at: instante(fila.created_at)!,
        updated_at: instante(fila.updated_at)!,
    }
}

export async function verPlanTemporal(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlanTemporalVista> {
    const fila = (await cliente
        .from('core.servicios_planes_temporales as t')
        .where('t.id', id)
        .select(columnasVista(cliente))
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El plan temporal ${id} no existe`)
    return normalizarVista(fila)
}

/** Planes temporales de un servicio, del más reciente al más viejo (cursor = id). */
export async function listarPlanesTemporales(
    servicioId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<PlanTemporalVista>> {
    const consulta = db
        .from('core.servicios_planes_temporales as t')
        .where('t.servicio_id', servicioId)
        .select(columnasVista(db.connection()))
    const pagina = await paginar<Record<string, unknown>>(consulta, opciones, {
        columna: 't.id',
        clave: (fila) => Number(fila.id),
    })
    return { ...pagina, data: pagina.data.map(normalizarVista) }
}

/** El plan temporal `programado` o `activo` del servicio (hay a lo más uno), o null. */
export async function planTemporalVigente(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlanTemporalVista | null> {
    const fila = (await cliente
        .from('core.servicios_planes_temporales as t')
        .where('t.servicio_id', servicioId)
        .whereIn('t.estado', ['programado', 'activo'])
        .select(columnasVista(cliente))
        .first()) as Record<string, unknown> | null
    return fila ? normalizarVista(fila) : null
}

/**
 * Interfaz pública para facturación (A3): el plan temporal `activo` del servicio, o null. Con él,
 * `facturas.emitir` cobra el plan del servicio (el temporal) con un descuento hasta el precio de
 * `plan_original_id` (`contratos/lealtad.md` §5, `mejora_facturacion`).
 */
export async function planTemporalActivo(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlanTemporalVista | null> {
    const vigente = await planTemporalVigente(servicioId, cliente)
    return vigente?.estado === 'activo' ? vigente : null
}

/** Bloquea la fila (FOR UPDATE) del plan temporal; 404 si no existe. */
export async function bloquearPlanTemporal(
    trx: TransactionClientContract,
    id: number,
): Promise<FilaPlanTemporal> {
    const fila = (await trx
        .from('core.servicios_planes_temporales')
        .where('id', id)
        .forUpdate()
        .select(
            'id',
            'empresa_id',
            'servicio_id',
            'plan_id',
            'plan_original_id',
            'inicio',
            'fin',
            'estado',
            'version',
        )
        .first()) as FilaPlanTemporal | null
    if (!fila) throw new NoEncontrado(`El plan temporal ${id} no existe`)
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        servicio_id: Number(fila.servicio_id),
        plan_id: Number(fila.plan_id),
        plan_original_id: Number(fila.plan_original_id),
        version: Number(fila.version),
    }
}

/** Ids pendientes hasta `ahora`: activos por terminar y programados por iniciar (cron). */
export async function planesTemporalesPendientes(
    ahora: Date,
    cliente: QueryClientContract = db.connection(),
): Promise<{ porTerminar: number[]; porIniciar: number[] }> {
    const porTerminar = (await cliente
        .from('core.servicios_planes_temporales')
        .where('estado', 'activo')
        .where('fin', '<=', ahora)
        .orderBy('fin')
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    const porIniciar = (await cliente
        .from('core.servicios_planes_temporales')
        .where('estado', 'programado')
        .where('inicio', '<=', ahora)
        .orderBy('inicio')
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    return {
        porTerminar: porTerminar.map((f) => Number(f.id)),
        porIniciar: porIniciar.map((f) => Number(f.id)),
    }
}

/** Valores de la fila que se auditan como diff (`audit.cambios`, entidad `plan_temporal`). */
export async function filaAuditable(trx: TransactionClientContract, id: number) {
    const vista = await verPlanTemporal(id, trx)
    const resto: Record<string, unknown> = { ...vista }
    delete resto.plan_nombre
    delete resto.plan_original_nombre
    return resto
}

/**
 * Plan temporal compatible con el servicio sin moverle IPs ni prefijos (no corta la sesión): mismo
 * `dual_stack` y mismo tamaño del prefijo delegado que el plan actual. 422 `plan_temporal_incompatible`.
 */
export function exigirPlanCompatible(
    actual: { dual_stack: string; tamano_prefijo_delegado: number },
    temporal: { nombre: string; dual_stack: string; tamano_prefijo_delegado: number },
) {
    if (
        actual.dual_stack !== temporal.dual_stack ||
        Number(actual.tamano_prefijo_delegado) !== Number(temporal.tamano_prefijo_delegado)
    ) {
        throw new ReglaNegocio(
            `El plan ${temporal.nombre} cambia IPv4/IPv6 o el tamaño del prefijo delegado: un plan temporal ` +
                'solo cambia velocidad y precio',
            'plan_temporal_incompatible',
        )
    }
}

/**
 * Cambia `core.servicios.plan_id` de `de` a `a` por un plan temporal: diff del servicio, tramo del
 * historial de asignaciones, `servicio.config_cambiada` (`campos: ['plan']`, `motivo:
 * 'plan_temporal'`) y reescritura de `aaa:user:*` al confirmar. No toca IPs ni prefijos.
 */
export async function cambiarPlanPorTemporal(
    t: Transaccion,
    datos: {
        servicioId: number
        empresaId: number
        de: number
        a: number
        planTemporalId: number
        tramo: string
    },
): Promise<void> {
    if (datos.de === datos.a) return
    await t.trx
        .from('core.servicios')
        .where('id', datos.servicioId)
        .update({
            plan_id: datos.a,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    await t.registrarCambios(
        { tipo: 'servicio', id: datos.servicioId },
        { plan_id: datos.de },
        { plan_id: datos.a },
    )
    await registrarTramo(t.trx, datos.servicioId, datos.tramo)
    await t.emit('servicio.config_cambiada', {
        servicio_id: datos.servicioId,
        empresa_id: datos.empresaId,
        campos: ['plan'],
        motivo: 'plan_temporal',
        plan_temporal_id: datos.planTemporalId,
    })
    refrescarAaaAlConfirmar(t, { servicioId: datos.servicioId })
}

/**
 * Cierra el plan temporal vigente de un servicio que se retira (lo llama `servicios.retirar` en su
 * transacción): `programado` o `activo` → `cancelado` con motivo `retiro`; si estaba activo, el
 * servicio vuelve a su plan base (sin evento propio: el retiro ya emite los suyos).
 */
export async function cancelarPorRetiro(t: Transaccion, servicioId: number): Promise<void> {
    const vigente = (await t.trx
        .from('core.servicios_planes_temporales')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['programado', 'activo'])
        .forUpdate()
        .select('id', 'estado', 'plan_id', 'plan_original_id')
        .first()) as {
        id: number
        estado: EstadoPlanTemporal
        plan_id: number
        plan_original_id: number
    } | null
    if (!vigente) return
    const id = Number(vigente.id)
    const antes = await filaAuditable(t.trx, id)
    if (vigente.estado === 'activo') {
        await t.trx
            .from('core.servicios')
            .where('id', servicioId)
            .where('plan_id', vigente.plan_id)
            .update({ plan_id: vigente.plan_original_id } as Record<string, unknown>)
    }
    await t.trx
        .from('core.servicios_planes_temporales')
        .where('id', id)
        .update({
            estado: 'cancelado',
            motivo: 'retiro',
            terminado_en: t.trx.knexRawQuery('now()'),
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    await t.registrarCambios({ tipo: 'plan_temporal', id }, antes, await filaAuditable(t.trx, id))
}
