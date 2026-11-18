import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { dimensionesServicio, servicioEnEmpresas } from '#core/consultas/servicios'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { Conflicto } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { inicioFacturacionSql } from '#billing/configuracion'
import { aplicarExcepciones } from '#billing/excepciones'
import { obtenerPlantilla, type Plantilla } from '#billing/plantillas'
import { primerPeriodoTrasAsignacion } from '#billing/periodos'

/**
 * Asignación masiva de una plantilla a los servicios vigentes **sin plantilla** (decisión del PM, 18
 * nov). La vista previa (`GET /plantillas-facturacion/:id/servicios-sin-plantilla`) y la acción
 * (`plantillas.asignar_sin_plantilla`) leen el mismo conjunto con `consultaSinPlantilla`.
 *
 * - Solo `activo`, `limitado` y `suspendido`: un `retirado` no se factura más y un
 *   `pendiente_instalacion` todavía no (al activarse sigue sin plantilla y aparece aquí la próxima vez).
 * - Filtrado por la empresa activa (o las del alcance del usuario) y por el alcance de router/zona del
 *   permiso, como `GET /servicios`.
 * - Primer periodo facturado: el siguiente inicio de ciclo después del día de la asignación
 *   (`primerPeriodoTrasAsignacion`), guardado en `billing.servicios_facturar_desde`.
 */

export const ESTADOS_ASIGNABLES = ['activo', 'limitado', 'suspendido'] as const
export type EstadoAsignable = (typeof ESTADOS_ASIGNABLES)[number]

/** Cuántos servicios trae la muestra de la vista previa. */
export const TAMANO_MUESTRA = 20

export interface FiltroSinPlantilla {
    /** empresas de la lista (`empresasDeLaLista`); null = todas */
    empresas: number[] | null
    /** alcance de router/zona del permiso; ausente = sin restricción */
    alcance?: Alcance
}

/** `core.servicios as s` vigentes sin plantilla, con los filtros de empresa y alcance. */
export function consultaSinPlantilla(
    cliente: QueryClientContract,
    filtro: FiltroSinPlantilla,
): DatabaseQueryBuilderContract<any> {
    const consulta = cliente
        .from('core.servicios as s')
        .whereNull('s.plantilla_facturacion_id')
        .whereIn('s.estado', [...ESTADOS_ASIGNABLES])
    filtrarPorAlcance(consulta, filtro.alcance, dimensionesServicio)
    filtrarPorEmpresa(consulta, filtro.empresas, servicioEnEmpresas)
    return consulta
}

/** 409 `plantilla_retirada`: una retirada no se asigna a nadie. */
export function exigirPlantillaAsignable(plantilla: Plantilla): void {
    if (plantilla.retirada_en !== null) {
        throw new Conflicto(
            `La plantilla ${plantilla.nombre} está retirada: no se asigna a servicios`,
            'plantilla_retirada',
            'Plantilla retirada',
        )
    }
}

export interface ServicioSinPlantilla {
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    empresa_id: number
    estado: EstadoAsignable
    user_ppp: string | null
    plan_nombre: string
    /** primer periodo que se le facturaría si se asigna hoy */
    facturar_desde: string
}

interface FilaSinPlantilla {
    id: number
    cliente_id: number
    cliente_nombre: string
    empresa_id: number
    estado: EstadoAsignable
    user_ppp: string | null
    plan_nombre: string
    inicio: string
}

/**
 * Servicios sin plantilla con su primer periodo si se les asigna `plantilla` hoy (sus excepciones
 * `dia`/`prorrateo` cuentan). `limite` null = todos (la acción), con `FOR UPDATE` si `bloquear`.
 */
export async function serviciosSinPlantilla(
    cliente: QueryClientContract,
    plantilla: Plantilla,
    filtro: FiltroSinPlantilla,
    opciones: { limite: number | null; bloquear?: boolean; hoy?: string },
): Promise<ServicioSinPlantilla[]> {
    const hoy = opciones.hoy ?? hoyGuatemala()
    const consulta = consultaSinPlantilla(cliente, filtro)
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .orderBy('s.id', 'asc')
        .select(
            's.id',
            's.cliente_id',
            'c.nombre as cliente_nombre',
            's.empresa_id',
            's.estado',
            's.user_ppp',
            'p.nombre as plan_nombre',
            cliente.raw(`to_char(${inicioFacturacionSql('s')}, 'YYYY-MM-DD') as inicio`),
        )
    if (opciones.limite !== null) consulta.limit(opciones.limite)
    if (opciones.bloquear) consulta.forUpdate('s')
    const filas = (await consulta) as FilaSinPlantilla[]
    if (filas.length === 0) return []

    const excepciones = (await cliente
        .from('core.servicios_excepciones')
        .whereIn(
            'servicio_id',
            filas.map((f) => f.id),
        )
        .select('servicio_id', 'campo', 'valor')) as Array<{
        servicio_id: number
        campo: string
        valor: unknown
    }>
    const porServicio = new Map<number, Array<{ campo: string; valor: unknown }>>()
    for (const e of excepciones) {
        const id = Number(e.servicio_id)
        porServicio.set(id, [...(porServicio.get(id) ?? []), e])
    }

    return filas.map((f) => {
        const config = aplicarExcepciones(plantilla, porServicio.get(Number(f.id)) ?? [])
        return {
            servicio_id: Number(f.id),
            cliente_id: Number(f.cliente_id),
            cliente_nombre: f.cliente_nombre,
            empresa_id: Number(f.empresa_id),
            estado: f.estado,
            user_ppp: f.user_ppp,
            plan_nombre: f.plan_nombre,
            facturar_desde: primerPeriodoTrasAsignacion(config, f.inicio, hoy),
        }
    })
}

/** Cantidad de servicios (nunca dinero). */
export type CantidadServicios = number

export type ConteoPorEstado = Record<EstadoAsignable, CantidadServicios>

/** Total y cuántos por estado. */
export async function contarSinPlantilla(
    cliente: QueryClientContract,
    filtro: FiltroSinPlantilla,
): Promise<{ total: CantidadServicios; por_estado: ConteoPorEstado }> {
    const filas = (await consultaSinPlantilla(cliente, filtro)
        .groupBy('s.estado')
        .select('s.estado')
        .count('* as n')) as Array<{ estado: EstadoAsignable; n: string | number }>
    const porEstado: ConteoPorEstado = { activo: 0, limitado: 0, suspendido: 0 }
    for (const f of filas) porEstado[f.estado] = Number(f.n)
    const total = ESTADOS_ASIGNABLES.reduce((suma, e) => suma + porEstado[e], 0)
    return { total, por_estado: porEstado }
}

export interface VistaPreviaSinPlantilla {
    plantilla: { id: number; nombre: string; ciclo: 'dia_fijo' | 'aniversario'; dia: number | null }
    total: CantidadServicios
    por_estado: ConteoPorEstado
    /**
     * primer periodo a facturar con la plantilla sin excepciones (`dia_fijo`); null en `aniversario`
     * (depende de cada servicio: ver `muestra[].facturar_desde`)
     */
    facturar_desde: string | null
    muestra: ServicioSinPlantilla[]
}

/**
 * Vista previa de solo lectura (`GET /plantillas-facturacion/:id/servicios-sin-plantilla`): lo que
 * haría `plantillas.asignar_sin_plantilla` ahora. 404 si la plantilla no existe, 409
 * `plantilla_retirada` si está retirada.
 */
export async function vistaPreviaSinPlantilla(
    plantillaId: number,
    filtro: FiltroSinPlantilla,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaPreviaSinPlantilla> {
    const plantilla = await obtenerPlantilla(plantillaId, cliente)
    exigirPlantillaAsignable(plantilla)
    const hoy = hoyGuatemala()
    const { total, por_estado: porEstado } = await contarSinPlantilla(cliente, filtro)
    const muestra = await serviciosSinPlantilla(cliente, plantilla, filtro, { limite: TAMANO_MUESTRA, hoy })
    return {
        plantilla: { id: plantilla.id, nombre: plantilla.nombre, ciclo: plantilla.ciclo, dia: plantilla.dia },
        total,
        por_estado: porEstado,
        facturar_desde:
            plantilla.ciclo === 'dia_fijo' ? primerPeriodoTrasAsignacion(plantilla, '0000-01-01', hoy) : null,
        muestra,
    }
}

/** Primer periodo facturable guardado por una asignación (null: factura desde su inicio). */
export async function facturarDesdeDe(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<string | null> {
    const fila = (await cliente
        .from('billing.servicios_facturar_desde')
        .where('servicio_id', servicioId)
        .select(cliente.raw(`to_char(facturar_desde, 'YYYY-MM-DD') as facturar_desde`))
        .first()) as { facturar_desde: string } | null
    return fila?.facturar_desde ?? null
}

/** Subconsulta SQL con el `facturar_desde` (texto `YYYY-MM-DD` o null) del servicio `alias`. */
export function facturarDesdeSql(alias: string): string {
    return `(SELECT to_char(fd.facturar_desde, 'YYYY-MM-DD') FROM billing.servicios_facturar_desde fd WHERE fd.servicio_id = ${alias}.id)`
}
