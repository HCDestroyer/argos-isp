import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import type { EstadoServicio } from '#shared/eventos'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Reglas para ganar puntos (`contratos/lealtad.md` §4). `condiciones` se guarda completa: el
 * validador de cada tipo (`#lealtad/validators`) llena los valores por defecto antes de guardar,
 * así lo que se lee es exactamente lo que se evalúa.
 */

export const TIPOS_REGLA = ['pago_a_tiempo', 'antiguedad', 'referido', 'pago_adelantado'] as const
export type TipoRegla = (typeof TIPOS_REGLA)[number]

/** Fase 1: solo puntos. `premio` (fase 2) y `boletos` (fase 3) llegan con sus tablas. */
export const RECOMPENSAS = ['puntos', 'premio', 'boletos'] as const
export type Recompensa = (typeof RECOMPENSAS)[number]

export const PERIODOS_TOPE = ['mes', 'anio'] as const
export type PeriodoTope = (typeof PERIODOS_TOPE)[number]

export interface CondicionesPagoATiempo {
    /** la factura debe quedar pagada al menos estos días antes de `vence_en` (0 = hasta ese día) */
    dias_antes_vencimiento: number
    /** solo facturas de servicio (no de mora) */
    solo_servicio: boolean
    /** no cuenta si el servicio tuvo una promesa de pago mientras la factura estaba abierta */
    sin_promesa: boolean
    /** bono al completar `periodos` facturas seguidas pagadas a tiempo (cada múltiplo) */
    racha: { periodos: number; puntos_extra: number } | null
    /** total mínimo de la factura (Q); null = cualquiera */
    monto_minimo: string | null
}

export interface CondicionesAntiguedad {
    /** cada cuántos meses desde la instalación se otorga */
    cada_meses: number
    /** no se otorga si en el ciclo hubo una factura pagada (o sin pagar) más de estos días después de vencer */
    sin_vencidas_mas_de_dias: number | null
    /** estados del servicio que reciben el premio */
    estados_validos: EstadoServicio[]
}

export interface CondicionesReferido {
    /** facturas pagadas del referido en la empresa antes de otorgar (evita altas falsas) */
    facturas_pagadas_minimas: number
    /** días desde el registro del referido para calificar; null = sin límite */
    dias_maximos: number | null
    /** referidos calificados como máximo por referidor en la empresa; null = sin tope */
    tope_por_referidor: number | null
    /** bono para el cliente referido (0 = sin bono) */
    puntos_referido: number
}

export interface CondicionesPagoAdelantado {
    /** mensualidades que debe cubrir el excedente del pago en Anticipos */
    periodos_minimos: number
    /** puntos por cada mensualidad cubierta (además de `puntos`) */
    puntos_por_periodo: number
}

export interface CondicionesPorTipo {
    pago_a_tiempo: CondicionesPagoATiempo
    antiguedad: CondicionesAntiguedad
    referido: CondicionesReferido
    pago_adelantado: CondicionesPagoAdelantado
}

export const CONDICIONES_POR_DEFECTO: { [T in TipoRegla]: CondicionesPorTipo[T] } = {
    pago_a_tiempo: {
        dias_antes_vencimiento: 0,
        solo_servicio: true,
        sin_promesa: true,
        racha: null,
        monto_minimo: null,
    },
    antiguedad: { cada_meses: 12, sin_vencidas_mas_de_dias: null, estados_validos: ['activo'] },
    referido: {
        facturas_pagadas_minimas: 2,
        dias_maximos: null,
        tope_por_referidor: null,
        puntos_referido: 0,
    },
    pago_adelantado: { periodos_minimos: 1, puntos_por_periodo: 0 },
}

/** Condiciones completas: lo recibido sobre los valores por defecto del tipo. */
export function completarCondiciones<T extends TipoRegla>(
    tipo: T,
    condiciones: Partial<CondicionesPorTipo[T]> | null | undefined,
): CondicionesPorTipo[T] {
    const base = CONDICIONES_POR_DEFECTO[tipo]
    const salida: Record<string, unknown> = { ...base }
    for (const [clave, valor] of Object.entries(condiciones ?? {})) {
        if (valor !== undefined && clave in base) salida[clave] = valor
    }
    return salida as unknown as CondicionesPorTipo[T]
}

export interface ReglaVista {
    id: number
    empresa_id: number
    programa_id: number
    tipo: TipoRegla
    condiciones: CondicionesPorTipo[TipoRegla]
    recompensa: Recompensa
    puntos: number
    premio_id: number | null
    sorteo_id: number | null
    tope_por_cliente: number | null
    periodo_tope: PeriodoTope | null
    activa: boolean
    vigente_desde: string
    vigente_hasta: string | null
    version: number
    created_at: Date
    updated_at: Date
}

/** Columnas editables (`audit.cambios`). */
export const CAMPOS_REGLA = [
    'condiciones',
    'recompensa',
    'puntos',
    'tope_por_cliente',
    'periodo_tope',
    'activa',
    'vigente_desde',
    'vigente_hasta',
] as const

function columnas(cliente: QueryClientContract) {
    return [
        'r.id',
        'r.empresa_id',
        'r.programa_id',
        'r.tipo',
        'r.condiciones',
        'r.recompensa',
        'r.puntos',
        'r.premio_id',
        'r.sorteo_id',
        'r.tope_por_cliente',
        'r.periodo_tope',
        'r.activa',
        cliente.raw(`to_char(r.vigente_desde, 'YYYY-MM-DD') as vigente_desde`),
        cliente.raw(`to_char(r.vigente_hasta, 'YYYY-MM-DD') as vigente_hasta`),
        'r.version',
        'r.created_at',
        'r.updated_at',
    ]
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function aVista(fila: Record<string, any>): ReglaVista {
    const tipo = fila.tipo as TipoRegla
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        programa_id: Number(fila.programa_id),
        tipo,
        condiciones: completarCondiciones(tipo, fila.condiciones),
        puntos: Number(fila.puntos),
        premio_id: n(fila.premio_id),
        sorteo_id: n(fila.sorteo_id),
        tope_por_cliente: n(fila.tope_por_cliente),
        version: Number(fila.version),
    } as ReglaVista
}

export async function verRegla(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<ReglaVista> {
    const consulta = cliente.from('lealtad.reglas as r').where('r.id', id).select(columnas(cliente))
    if (bloquear) consulta.forUpdate()
    const fila = await consulta.first()
    if (!fila) throw new NoEncontrado(`La regla de lealtad ${id} no existe`)
    return aVista(fila)
}

/** Reglas activas del programa vigentes en `fecha` (YYYY-MM-DD), opcionalmente de un tipo. */
export async function reglasVigentes(
    cliente: QueryClientContract,
    programaId: number,
    fecha: string,
    tipo?: TipoRegla,
): Promise<ReglaVista[]> {
    const filas = await cliente
        .from('lealtad.reglas as r')
        .where('r.programa_id', programaId)
        .where('r.activa', true)
        .where('r.vigente_desde', '<=', fecha)
        .where((q) => q.whereNull('r.vigente_hasta').orWhere('r.vigente_hasta', '>=', fecha))
        .if(tipo !== undefined, (q) => q.where('r.tipo', tipo!))
        .orderBy('r.id', 'asc')
        .select(columnas(cliente))
    return filas.map(aVista)
}

export interface FiltrosReglas extends OpcionesPaginacion {
    programa_id?: number
    tipo?: TipoRegla
    activa?: boolean
}

export async function listarReglas(
    empresas: number[] | null,
    filtros: FiltrosReglas,
): Promise<Pagina<ReglaVista>> {
    const consulta = db
        .from('lealtad.reglas as r')
        .if(empresas !== null, (q) => q.whereIn('r.empresa_id', empresas!))
        .if(filtros.programa_id !== undefined, (q) => q.where('r.programa_id', filtros.programa_id!))
        .if(filtros.tipo !== undefined, (q) => q.where('r.tipo', filtros.tipo!))
        .if(filtros.activa !== undefined, (q) => q.where('r.activa', filtros.activa!))
        .select(columnas(db.connection()))
    const pagina = await paginar(consulta, filtros, { columna: 'r.id' })
    return { data: pagina.data.map(aVista), nextCursor: pagina.nextCursor }
}

export function camposAuditables(regla: ReglaVista): Record<string, unknown> {
    return Object.fromEntries(CAMPOS_REGLA.map((c) => [c, regla[c]]))
}
