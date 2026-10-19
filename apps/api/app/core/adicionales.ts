import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Decimal } from 'decimal.js'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { exigirAccesoEmpresa, filtrarPorEmpresa } from '#shared/empresa_activa'
import type { ModalidadAdicional, PayloadEvento } from '#shared/eventos'

/**
 * Servicios adicionales (decisión del PM, 19 oct; `contratos/adicionales.md`): catálogo por empresa
 * (`core.adicionales`), motivos de cortesía (`core.motivos_cortesia`), asignaciones a un servicio
 * (`core.servicios_adicionales`) y adicionales incluidos en un plan (`network.planes_adicionales`).
 *
 * Lecturas y piezas comunes de las acciones. La credencial nunca sale de aquí: las vistas solo dicen
 * si hay una (`tiene_credencial`); se lee en claro con `servicios.ver_credencial_adicional`.
 */

export type EstadoAsignacionAdicional = 'activo' | 'baja'

export interface AdicionalVista {
    id: number
    empresa_id: number
    codigo: string
    nombre: string
    descripcion: string | null
    /** numeric(14,2) como string o null */
    precio_sugerido: string | null
    activo: boolean
    version: number
    created_at: string
    updated_at: string
}

export interface MotivoCortesiaVista {
    id: number
    /** null = común a todas las empresas */
    empresa_id: number | null
    codigo: string
    nombre: string
    activo: boolean
    version: number
    created_at: string
    updated_at: string
}

export interface AsignacionAdicionalVista {
    id: number
    empresa_id: number
    servicio_id: number
    adicional_id: number
    adicional_codigo: string
    adicional_nombre: string
    modalidad: ModalidadAdicional
    identificador: string | null
    tiene_credencial: boolean
    precio: string | null
    motivo_id: number | null
    motivo_nombre: string | null
    motivo_detalle: string | null
    plan_id: number | null
    estado: EstadoAsignacionAdicional
    alta_en: string
    baja_en: string | null
    motivo_baja: string | null
    version: number
    created_at: string
    updated_at: string
}

export interface AdicionalPlanVista {
    plan_id: number
    adicional_id: number
    empresa_id: number
    adicional_codigo: string
    adicional_nombre: string
    adicional_activo: boolean
    cantidad: number
}

/** Fila cruda de `core.servicios_adicionales` (con la credencial cifrada): solo para auditoría. */
export type FilaAsignacion = Record<string, unknown> & {
    id: number
    empresa_id: number
    servicio_id: number
    adicional_id: number
    modalidad: ModalidadAdicional
    estado: EstadoAsignacionAdicional
    version: number
}

const COLUMNAS_ADICIONAL = [
    'id',
    'empresa_id',
    'codigo',
    'nombre',
    'descripcion',
    'precio_sugerido',
    'activo',
    'version',
    'created_at',
    'updated_at',
]

const COLUMNAS_MOTIVO = [
    'id',
    'empresa_id',
    'codigo',
    'nombre',
    'activo',
    'version',
    'created_at',
    'updated_at',
]

function normalizarAdicional(fila: Record<string, unknown>): AdicionalVista {
    return {
        ...(fila as unknown as AdicionalVista),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
    }
}

function normalizarMotivo(fila: Record<string, unknown>): MotivoCortesiaVista {
    return {
        ...(fila as unknown as MotivoCortesiaVista),
        id: Number(fila.id),
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
    }
}

export async function verAdicional(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AdicionalVista> {
    const fila = await cliente.from('core.adicionales').where('id', id).select(COLUMNAS_ADICIONAL).first()
    if (!fila) throw new NoEncontrado(`El adicional ${id} no existe`)
    return normalizarAdicional(fila)
}

export interface FiltrosAdicionales extends OpcionesPaginacion {
    q?: string
    activo?: boolean
}

/** Catálogo de las empresas de la lista (`empresasDeLaLista`; null = todas), del más nuevo al más viejo. */
export async function listarAdicionales(
    filtros: FiltrosAdicionales,
    empresas: number[] | null,
): Promise<Pagina<AdicionalVista>> {
    const consulta = db.from('core.adicionales').select(COLUMNAS_ADICIONAL)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('empresa_id', ids))
    if (filtros.activo !== undefined) consulta.where('activo', filtros.activo)
    if (filtros.q) {
        const patron = `%${filtros.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        consulta.where((q) => q.whereILike('nombre', patron).orWhereILike('codigo', patron))
    }
    const pagina = await paginar(consulta, filtros)
    return { ...pagina, data: pagina.data.map((f) => normalizarAdicional(f as Record<string, unknown>)) }
}

export async function verMotivoCortesia(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MotivoCortesiaVista> {
    const fila = await cliente.from('core.motivos_cortesia').where('id', id).select(COLUMNAS_MOTIVO).first()
    if (!fila) throw new NoEncontrado(`El motivo de cortesía ${id} no existe`)
    return normalizarMotivo(fila)
}

/** Motivos comunes y los de las empresas de la lista (null = todas), por nombre. */
export async function listarMotivosCortesia(
    empresas: number[] | null,
    filtros: { activo?: boolean } = {},
): Promise<MotivoCortesiaVista[]> {
    const consulta = db.from('core.motivos_cortesia').select(COLUMNAS_MOTIVO)
    if (empresas !== null) consulta.where((q) => q.whereNull('empresa_id').orWhereIn('empresa_id', empresas))
    if (filtros.activo !== undefined) consulta.where('activo', filtros.activo)
    const filas = (await consulta.orderBy('nombre', 'asc').orderBy('id', 'asc')) as Array<
        Record<string, unknown>
    >
    return filas.map(normalizarMotivo)
}

function consultaAsignaciones(cliente: QueryClientContract) {
    return cliente
        .from('core.servicios_adicionales as sa')
        .join('core.adicionales as a', 'a.id', 'sa.adicional_id')
        .leftJoin('core.motivos_cortesia as m', 'm.id', 'sa.motivo_id')
        .select(
            'sa.id',
            'sa.empresa_id',
            'sa.servicio_id',
            'sa.adicional_id',
            'a.codigo as adicional_codigo',
            'a.nombre as adicional_nombre',
            'sa.modalidad',
            'sa.identificador',
            cliente.raw('(sa.credencial IS NOT NULL) AS tiene_credencial'),
            'sa.precio',
            'sa.motivo_id',
            'm.nombre as motivo_nombre',
            'sa.motivo_detalle',
            'sa.plan_id',
            'sa.estado',
            'sa.alta_en',
            'sa.baja_en',
            'sa.motivo_baja',
            'sa.version',
            'sa.created_at',
            'sa.updated_at',
        )
}

function normalizarAsignacion(fila: Record<string, unknown>): AsignacionAdicionalVista {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        ...(fila as unknown as AsignacionAdicionalVista),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        servicio_id: Number(fila.servicio_id),
        adicional_id: Number(fila.adicional_id),
        motivo_id: n(fila.motivo_id),
        plan_id: n(fila.plan_id),
        tiene_credencial: Boolean(fila.tiene_credencial),
    }
}

/** Una asignación del servicio; 404 si no existe o es de otro servicio. */
export async function verAsignacion(
    servicioId: number,
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AsignacionAdicionalVista> {
    const fila = await consultaAsignaciones(cliente)
        .where('sa.id', id)
        .where('sa.servicio_id', servicioId)
        .first()
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no tiene el adicional asignado ${id}`)
    return normalizarAsignacion(fila)
}

/** Adicionales de un servicio, del más nuevo al más viejo; `estado` filtra activos o bajas. */
export async function listarAsignaciones(
    servicioId: number,
    filtros: OpcionesPaginacion & { estado?: EstadoAsignacionAdicional },
): Promise<Pagina<AsignacionAdicionalVista>> {
    const consulta = consultaAsignaciones(db.connection()).where('sa.servicio_id', servicioId)
    if (filtros.estado) consulta.where('sa.estado', filtros.estado)
    const pagina = await paginar(consulta, filtros, { columna: 'sa.id' })
    return { ...pagina, data: pagina.data.map((f) => normalizarAsignacion(f as Record<string, unknown>)) }
}

/** Adicionales que trae un plan (de todas las empresas), por nombre. `exigirPlan`: 404 si no existe. */
export async function adicionalesDelPlan(
    planId: number,
    cliente: QueryClientContract = db.connection(),
    opciones: { exigirPlan?: boolean } = {},
): Promise<AdicionalPlanVista[]> {
    if (opciones.exigirPlan) {
        const plan = await cliente.from('network.planes').where('id', planId).select('id').first()
        if (!plan) throw new NoEncontrado(`El plan ${planId} no existe`)
    }
    const filas = (await cliente
        .from('network.planes_adicionales as pa')
        .join('core.adicionales as a', 'a.id', 'pa.adicional_id')
        .where('pa.plan_id', planId)
        .orderBy('a.nombre', 'asc')
        .orderBy('a.id', 'asc')
        .select(
            'pa.plan_id',
            'pa.adicional_id',
            'a.empresa_id',
            'a.codigo as adicional_codigo',
            'a.nombre as adicional_nombre',
            'a.activo as adicional_activo',
            'pa.cantidad',
        )) as Array<Record<string, unknown>>
    return filas.map((f) => ({
        ...(f as unknown as AdicionalPlanVista),
        plan_id: Number(f.plan_id),
        adicional_id: Number(f.adicional_id),
        empresa_id: Number(f.empresa_id),
        cantidad: Number(f.cantidad),
    }))
}

/*
|--------------------------------------------------------------------------
| Reglas comunes de las acciones
|--------------------------------------------------------------------------
*/

/** Fila cruda (con la credencial cifrada) para el diff de `audit.cambios`; la credencial sale `***`. */
export async function filaAsignacion(t: Transaccion, id: number, bloquear = false): Promise<FilaAsignacion> {
    const consulta = t.trx.from('core.servicios_adicionales').where('id', id)
    if (bloquear) consulta.forUpdate()
    const fila = (await consulta.first()) as FilaAsignacion | null
    if (!fila) throw new NoEncontrado(`El adicional asignado ${id} no existe`)
    return {
        ...fila,
        id: Number(fila.id),
        servicio_id: Number(fila.servicio_id),
        version: Number(fila.version),
    }
}

/** 422 en `precio` si no es > 0 (solo con `cobrado`). */
export function exigirPrecioPositivo(precio: string) {
    if (!new Decimal(precio).greaterThan(0)) {
        throw new ValidacionFallida([
            { field: 'precio', message: 'El precio debe ser mayor que 0', rule: 'min' },
        ])
    }
}

/** Motivo de cortesía activo, común o de la empresa; 422 en `motivo_id` si no. */
export async function exigirMotivoCortesia(t: Transaccion, motivoId: number, empresaId: number) {
    const motivo = (await t.trx
        .from('core.motivos_cortesia')
        .where('id', motivoId)
        .select('empresa_id', 'activo')
        .first()) as { empresa_id: number | null; activo: boolean } | null
    if (!motivo) {
        throw new ValidacionFallida([{ field: 'motivo_id', message: 'El motivo no existe', rule: 'exists' }])
    }
    if (motivo.empresa_id !== null && Number(motivo.empresa_id) !== empresaId) {
        throw new ValidacionFallida([
            { field: 'motivo_id', message: 'El motivo es de otra empresa', rule: 'misma_empresa' },
        ])
    }
    if (!motivo.activo) {
        throw new ValidacionFallida([
            { field: 'motivo_id', message: 'El motivo está desactivado', rule: 'activo' },
        ])
    }
}

export interface ServicioDeAdicional {
    id: number
    empresa_id: number
    cliente_id: number
}

type Origen<E extends 'servicio.adicional_agregado' | 'servicio.adicional_quitado'> =
    PayloadEvento<E>['origen']

function payload(fila: FilaAsignacion, servicio: ServicioDeAdicional) {
    return {
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        // la de la asignación: al cambiar de empresa, los incluidos viejos salen con la anterior
        empresa_id: Number(fila.empresa_id),
        adicional_id: Number(fila.adicional_id),
        asignacion_id: fila.id,
        modalidad: fila.modalidad,
    }
}

/**
 * Inserta una asignación (ya validada), registra su alta en `audit.cambios` (entidad
 * `servicio_adicional`, la credencial como `***`) y emite `servicio.adicional_agregado`.
 */
export async function insertarAsignacion(
    t: Transaccion,
    servicio: ServicioDeAdicional,
    datos: {
        adicional_id: number
        modalidad: ModalidadAdicional
        identificador?: string | null
        credencial?: string | null
        precio?: string | null
        motivo_id?: number | null
        motivo_detalle?: string | null
        plan_id?: number | null
    },
    origen: Origen<'servicio.adicional_agregado'>,
): Promise<FilaAsignacion> {
    const [nueva] = (await t.trx
        .insertQuery()
        .table('core.servicios_adicionales')
        .insert({
            empresa_id: servicio.empresa_id,
            servicio_id: servicio.id,
            adicional_id: datos.adicional_id,
            modalidad: datos.modalidad,
            identificador: datos.identificador ?? null,
            credencial: datos.credencial ?? null,
            precio: datos.precio ?? null,
            motivo_id: datos.motivo_id ?? null,
            motivo_detalle: datos.motivo_detalle ?? null,
            plan_id: datos.plan_id ?? null,
        })
        .returning('id')) as Array<{ id: number }>
    const fila = await filaAsignacion(t, Number(nueva!.id))
    await t.registrarCambios({ tipo: 'servicio_adicional', id: fila.id }, null, fila)
    await t.emit('servicio.adicional_agregado', { ...payload(fila, servicio), origen })
    return fila
}

/** Da de baja una asignación activa (nunca DELETE): `estado = baja`, `baja_en`, diff y evento. */
export async function darDeBajaAsignacion(
    t: Transaccion,
    servicio: ServicioDeAdicional,
    antes: FilaAsignacion,
    origen: Origen<'servicio.adicional_quitado'>,
    motivo: string | null,
): Promise<FilaAsignacion> {
    await t.trx
        .from('core.servicios_adicionales')
        .where('id', antes.id)
        .update({
            estado: 'baja',
            baja_en: t.trx.knexRawQuery('now()'),
            motivo_baja: motivo ?? origen,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    const despues = await filaAsignacion(t, antes.id)
    await t.registrarCambios({ tipo: 'servicio_adicional', id: antes.id }, antes, despues)
    await t.emit('servicio.adicional_quitado', { ...payload(despues, servicio), origen, motivo })
    return despues
}

/** Asignaciones activas del servicio (bloqueadas), en orden de alta. */
async function activas(t: Transaccion, servicioId: number): Promise<FilaAsignacion[]> {
    const filas = (await t.trx
        .from('core.servicios_adicionales')
        .where('servicio_id', servicioId)
        .where('estado', 'activo')
        .orderBy('id', 'asc')
        .forUpdate()) as FilaAsignacion[]
    return filas.map((f) => ({ ...f, id: Number(f.id), version: Number(f.version) }))
}

/**
 * Deja los `incluido` del servicio iguales a los que trae `planId` para su empresa
 * (`contratos/adicionales.md`, "Plan con adicionales incluidos"):
 *
 * - Se toman del plan solo los adicionales activos de la empresa del servicio, con su cantidad.
 * - Un `incluido` vigente de un adicional que el plan nuevo también trae se conserva (con su
 *   identificador y su credencial), hasta la cantidad del plan nuevo; pasa a ese `plan_id`.
 * - Los demás `incluido` se dan de baja (`origen`); los que faltan se agregan (`origen: plan`).
 * - `cortesia` y `cobrado` no se tocan.
 *
 * La usan `servicios.crear` (sin incluidos previos), `servicios.editar` al cambiar de plan y
 * `servicios.cambiar_empresa`. Un plan temporal no la llama.
 */
export async function reconciliarIncluidos(
    t: Transaccion,
    servicio: ServicioDeAdicional,
    planId: number,
    origen: 'cambio_plan' | 'cambio_empresa',
): Promise<void> {
    const deseados = new Map<number, number>()
    for (const item of await adicionalesDelPlan(planId, t.trx)) {
        if (item.empresa_id === servicio.empresa_id && item.adicional_activo) {
            deseados.set(item.adicional_id, item.cantidad)
        }
    }
    const vigentes = await activas(t, servicio.id)
    const incluidos = vigentes.filter((f) => f.modalidad === 'incluido')
    const conservados = new Map<number, number>()
    for (const fila of incluidos) {
        const adicionalId = Number(fila.adicional_id)
        const ya = conservados.get(adicionalId) ?? 0
        if (ya < (deseados.get(adicionalId) ?? 0)) {
            conservados.set(adicionalId, ya + 1)
            if (fila.plan_id === null || Number(fila.plan_id) !== planId) {
                await t.trx
                    .from('core.servicios_adicionales')
                    .where('id', fila.id)
                    .update({
                        plan_id: planId,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    } as Record<string, unknown>)
                const despues = await filaAsignacion(t, fila.id)
                await t.registrarCambios({ tipo: 'servicio_adicional', id: fila.id }, fila, despues)
            }
            continue
        }
        await darDeBajaAsignacion(t, servicio, fila, origen, null)
    }
    for (const [adicionalId, cantidad] of deseados) {
        for (let i = conservados.get(adicionalId) ?? 0; i < cantidad; i++) {
            await insertarAsignacion(
                t,
                servicio,
                { adicional_id: adicionalId, modalidad: 'incluido', plan_id: planId },
                'plan',
            )
        }
    }
}

/** Retiro del servicio: todos sus adicionales activos pasan a `baja` (`origen: retiro`). */
export async function darDeBajaPorRetiro(t: Transaccion, servicio: ServicioDeAdicional, motivo: string) {
    for (const fila of await activas(t, servicio.id)) {
        await darDeBajaAsignacion(t, servicio, fila, 'retiro', motivo)
    }
}

/**
 * Servicio (bloqueado) al que se agrega, edita o quita un adicional: 404 si no existe, 403 si su
 * empresa no está en el alcance del actor, 422 `servicio_retirado` si está retirado. Suspendido o
 * limitado sí admite cambios: los adicionales son informativos (la facturación decide los cobrados).
 */
export async function servicioParaAdicional(
    t: Transaccion,
    servicioId: number,
): Promise<ServicioDeAdicional> {
    const fila = (await t.trx
        .from('core.servicios')
        .where('id', servicioId)
        .forUpdate()
        .select('id', 'empresa_id', 'cliente_id', 'estado')
        .first()) as { id: number; empresa_id: number; cliente_id: number; estado: string } | null
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    const servicio = {
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        cliente_id: Number(fila.cliente_id),
    }
    t.fijarEmpresa(servicio.empresa_id)
    exigirAccesoEmpresa(t.ctx, servicio.empresa_id)
    if (fila.estado === 'retirado') {
        throw new ReglaNegocio('El servicio está retirado: sus adicionales no cambian', 'servicio_retirado')
    }
    return servicio
}

/** ¿Tiene el servicio adicionales `cortesia` o `cobrado` vigentes? (no cambian de empresa solos) */
export async function tieneAdicionalesPropios(t: Transaccion, servicioId: number): Promise<boolean> {
    const fila = await t.trx
        .from('core.servicios_adicionales')
        .where('servicio_id', servicioId)
        .where('estado', 'activo')
        .whereIn('modalidad', ['cortesia', 'cobrado'])
        .select('id')
        .first()
    return Boolean(fila)
}
