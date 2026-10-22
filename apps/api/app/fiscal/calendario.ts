import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { codificarCursor, decodificarCursor, LIMITE_MAXIMO, LIMITE_POR_DEFECTO } from '#shared/paginacion'
import {
    IMPUESTOS_OBLIGACION,
    OBLIGACIONES_GT,
    type DefinicionObligacion,
    type ImpuestoObligacion,
    type Periodicidad,
} from '#fiscal/l10n/gt/obligaciones'

/**
 * Calendario fiscal (contrato §3.7, §9.3 y §21 PR A): días hábiles, vencimientos y lecturas de
 * `fiscal.obligaciones` y `fiscal.feriados`. Las fechas son días calendario de Guatemala
 * (YYYY-MM-DD); se calculan en UTC sin hora para no depender de la zona del proceso.
 */

/** Umbrales de `fiscal.vencimiento_proximo` en días (contrato §11.3). */
export const UMBRALES_VENCIMIENTO = [7, 3, 1, 0] as const

/** Advisory lock por empresa del calendario (lo toman la generación y las alertas). */
export const LOCK_CALENDARIO = 3041

export const ESTADOS_OBLIGACION = ['pendiente', 'borrador', 'presentada', 'no_aplica'] as const
export type EstadoObligacion = (typeof ESTADOS_OBLIGACION)[number]

/** Estados que aún esperan presentarse: se recalculan y reciben alertas. */
export const ESTADOS_ABIERTOS: readonly EstadoObligacion[] = ['pendiente', 'borrador']

const dia = (fecha: string) => DateTime.fromISO(fecha, { zone: 'utc' })
const iso = (fecha: DateTime) => fecha.toISODate()!

// ---------------------------------------------------------------------------------------------
// Días hábiles y vencimientos (funciones puras)
// ---------------------------------------------------------------------------------------------

/** Hábil = de lunes a viernes y no feriado (§15 #22 y #60: contador). */
export function esDiaHabil(fecha: string, feriados: ReadonlySet<string>): boolean {
    return dia(fecha).weekday <= 5 && !feriados.has(fecha)
}

/** La misma fecha si es hábil; si no, el siguiente día hábil. */
export function siguienteHabil(fecha: string, feriados: ReadonlySet<string>): string {
    let actual = dia(fecha)
    while (!esDiaHabil(iso(actual), feriados)) actual = actual.plus({ days: 1 })
    return iso(actual)
}

/** n-ésimo día hábil (n ≥ 1) desde `inicio` inclusive. */
export function enesimoDiaHabil(inicio: string, n: number, feriados: ReadonlySet<string>): string {
    let actual = dia(inicio)
    let contados = 0
    for (;;) {
        if (esDiaHabil(iso(actual), feriados)) contados += 1
        if (contados >= n) return iso(actual)
        actual = actual.plus({ days: 1 })
    }
}

/** Valor del parámetro de plazo (formas en `l10n/gt/obligaciones.ts`). */
export interface ReglaPlazo {
    plazo?: string
    dias?: number
    dias_habiles?: boolean
    vence?: string
    formulario?: string | null
    cuarto_trimestre?: string
    periodo?: string
}

export class PlazoInvalido extends Error {}

/**
 * Vencimiento de un periodo que termina en `periodoHasta`: `base` es la fecha que da la regla y
 * `vence_en` la misma o el siguiente día hábil si cae en inhábil.
 */
export function calcularVencimiento(
    periodoHasta: string,
    regla: ReglaPlazo,
    feriados: ReadonlySet<string>,
): { base: string; vence_en: string } {
    const mesSiguiente = dia(periodoHasta).plus({ months: 1 }).startOf('month')
    let base: string
    if (typeof regla.vence === 'string' && /^\d{2}-\d{2}$/.test(regla.vence)) {
        const anio = dia(periodoHasta).year + 1
        const fecha = DateTime.fromISO(`${anio}-${regla.vence}`, { zone: 'utc' })
        if (!fecha.isValid) throw new PlazoInvalido(`vence ${regla.vence} no es una fecha`)
        base = iso(fecha)
    } else if (regla.plazo === 'mes_siguiente') {
        base = iso(mesSiguiente.endOf('month'))
    } else if (Number.isInteger(regla.dias) && (regla.dias ?? 0) >= 1 && (regla.dias ?? 0) <= 31) {
        const n = regla.dias!
        base = regla.dias_habiles
            ? enesimoDiaHabil(iso(mesSiguiente), n, feriados)
            : iso(DateTime.min(mesSiguiente.plus({ days: n - 1 }), mesSiguiente.endOf('month'))!)
    } else {
        throw new PlazoInvalido('El plazo no tiene vence, plazo = mes_siguiente ni dias')
    }
    return { base, vence_en: siguienteHabil(base, feriados) }
}

export interface Periodo {
    desde: string
    hasta: string
    /** 1–4 en los trimestrales; null en los demás */
    trimestre: number | null
}

/** Periodos de la periodicidad que terminan en o después de `desde` y empiezan en o antes de `hasta`. */
export function periodosEntre(periodicidad: Periodicidad, desde: string, hasta: string): Periodo[] {
    const unidad = periodicidad === 'mensual' ? 'month' : periodicidad === 'trimestral' ? 'quarter' : 'year'
    const salida: Periodo[] = []
    let inicio = dia(desde).startOf(unidad)
    const tope = dia(hasta)
    while (inicio <= tope) {
        const fin = inicio.endOf(unidad)
        salida.push({
            desde: iso(inicio),
            hasta: iso(fin),
            trimestre: periodicidad === 'trimestral' ? inicio.quarter : null,
        })
        inicio = fin.plus({ days: 1 }).startOf('day')
    }
    return salida
}

/** Días calendario de `hoy` a `vence` (negativo si ya venció). */
export function diasEntre(hoy: string, vence: string): number {
    return Math.round(dia(vence).diff(dia(hoy), 'days').days)
}

/** Umbral de alerta que corresponde a `dias` restantes: el menor que ya se alcanzó, o null. */
export function umbralVencimiento(dias: number): number | null {
    if (dias < 0) return null
    const alcanzados = UMBRALES_VENCIMIENTO.filter((u) => dias <= u)
    return alcanzados.length > 0 ? Math.min(...alcanzados) : null
}

/** Definición de un impuesto del calendario (hoy solo GT). */
export function definicionObligacion(impuesto: string): DefinicionObligacion | null {
    return OBLIGACIONES_GT.find((d) => d.impuesto === impuesto) ?? null
}

// ---------------------------------------------------------------------------------------------
// Feriados
// ---------------------------------------------------------------------------------------------

export interface FeriadoVista {
    id: number
    fecha: string
    nombre: string
    activo: boolean
    origen: 'paquete' | 'usuario'
    motivo: string
    creado_por: number | null
    created_at: Date
}

function normalizarFeriado(fila: Record<string, unknown>): FeriadoVista {
    return {
        id: Number(fila.id),
        fecha: String(fila.fecha),
        nombre: String(fila.nombre),
        activo: Boolean(fila.activo),
        origen: fila.origen as FeriadoVista['origen'],
        motivo: String(fila.motivo),
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
        created_at: fila.created_at as Date,
    }
}

const COLUMNAS_FERIADO = [
    'id',
    db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
    'nombre',
    'activo',
    'origen',
    'motivo',
    'creado_por',
    'created_at',
]

/** Fila vigente (la última) de cada fecha, dentro del rango si se da. */
export async function feriadosVigentesFilas(
    cliente: QueryClientContract = db.connection(),
    rango: { desde?: string; hasta?: string } = {},
): Promise<FeriadoVista[]> {
    const filas = (await cliente
        .from('fiscal.feriados')
        .if(rango.desde, (q) => q.where('fecha', '>=', rango.desde!))
        .if(rango.hasta, (q) => q.where('fecha', '<=', rango.hasta!))
        .distinctOn('fecha')
        .orderBy([
            { column: 'fecha', order: 'asc' },
            { column: 'id', order: 'desc' },
        ])
        .select(COLUMNAS_FERIADO)) as Array<Record<string, unknown>>
    return filas.map(normalizarFeriado)
}

/** Fechas inhábiles por feriado (las vigentes activas). */
export async function feriadosVigentes(cliente: QueryClientContract = db.connection()): Promise<Set<string>> {
    const filas = await feriadosVigentesFilas(cliente)
    return new Set(filas.filter((f) => f.activo).map((f) => f.fecha))
}

/** Feriados de un año: los vigentes activos y el historial completo de filas. */
export async function listarFeriados(anio: number) {
    const desde = `${anio}-01-01`
    const hasta = `${anio}-12-31`
    const filas = await feriadosVigentesFilas(db.connection(), { desde, hasta })
    const vigentes = filas.filter((f) => f.activo)
    const historial = (
        (await db
            .from('fiscal.feriados')
            .whereBetween('fecha', [desde, hasta])
            .orderBy([
                { column: 'fecha', order: 'asc' },
                { column: 'id', order: 'asc' },
            ])
            .select(COLUMNAS_FERIADO)) as Array<Record<string, unknown>>
    ).map(normalizarFeriado)
    return { anio, vigentes, historial }
}

export async function verFeriado(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('fiscal.feriados')
        .where('id', id)
        .select(COLUMNAS_FERIADO)
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El feriado ${id} no existe`)
    return normalizarFeriado(fila)
}

// ---------------------------------------------------------------------------------------------
// Obligaciones
// ---------------------------------------------------------------------------------------------

export interface ObligacionFila {
    id: number
    empresa_id: number
    impuesto: ImpuestoObligacion
    periodo_desde: string
    periodo_hasta: string
    formulario: string | null
    vence_en: string
    regla: Record<string, unknown>
    estado: EstadoObligacion
    motivo_estado: string | null
    declaracion_id: number | null
    version: number
    created_at: Date
    updated_at: Date
}

export interface ObligacionVista extends ObligacionFila {
    nombre: string
    periodicidad: Periodicidad
    /** días calendario de hoy (Guatemala) al vencimiento; negativo si ya venció */
    dias_restantes: number
    /** vencida y sin presentar (pendiente o borrador) */
    vencida: boolean
}

export const COLUMNAS_OBLIGACION = [
    'o.id',
    'o.empresa_id',
    'o.impuesto',
    db.raw(`to_char(o.periodo_desde, 'YYYY-MM-DD') as periodo_desde`),
    db.raw(`to_char(o.periodo_hasta, 'YYYY-MM-DD') as periodo_hasta`),
    'o.formulario',
    db.raw(`to_char(o.vence_en, 'YYYY-MM-DD') as vence_en`),
    'o.regla',
    'o.estado',
    'o.motivo_estado',
    'o.declaracion_id',
    'o.version',
    'o.created_at',
    'o.updated_at',
]

export function normalizarObligacion(fila: Record<string, unknown>): ObligacionFila {
    return {
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        impuesto: fila.impuesto as ImpuestoObligacion,
        periodo_desde: String(fila.periodo_desde),
        periodo_hasta: String(fila.periodo_hasta),
        formulario: (fila.formulario as string | null) ?? null,
        vence_en: String(fila.vence_en),
        regla: (fila.regla as Record<string, unknown>) ?? {},
        estado: fila.estado as EstadoObligacion,
        motivo_estado: (fila.motivo_estado as string | null) ?? null,
        declaracion_id: fila.declaracion_id === null ? null : Number(fila.declaracion_id),
        version: Number(fila.version),
        created_at: fila.created_at as Date,
        updated_at: fila.updated_at as Date,
    }
}

export function vistaObligacion(fila: ObligacionFila, hoy: string): ObligacionVista {
    const def = definicionObligacion(fila.impuesto)
    const dias = diasEntre(hoy, fila.vence_en)
    return {
        ...fila,
        nombre: def?.nombre ?? fila.impuesto,
        periodicidad: def?.periodicidad ?? 'mensual',
        dias_restantes: dias,
        vencida: dias < 0 && ESTADOS_ABIERTOS.includes(fila.estado),
    }
}

export interface FiltrosObligaciones {
    cursor?: string | null
    limit?: number | null
    impuesto?: string[] | null
    estado?: string[] | null
    /** true: vencidas sin presentar; false: las demás */
    vencida?: boolean | null
    /** vence_en desde / hasta (inclusive) */
    desde?: string | null
    hasta?: string | null
}

/**
 * Obligaciones por vencimiento ascendente (y id), con cursor compuesto `vence_en#id`. `empresas`
 * null = todas (alcance global).
 */
export async function listarObligaciones(
    filtros: FiltrosObligaciones,
    empresas: number[] | null,
    hoy: string,
) {
    const limite = Math.min(Math.max(filtros.limit ?? LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO)
    const consulta = db
        .from('fiscal.obligaciones as o')
        .select(COLUMNAS_OBLIGACION)
        .if(filtros.impuesto && filtros.impuesto.length > 0, (q) =>
            q.whereIn('o.impuesto', filtros.impuesto!),
        )
        .if(filtros.estado && filtros.estado.length > 0, (q) => q.whereIn('o.estado', filtros.estado!))
        .if(filtros.vencida === true, (q) =>
            q.whereIn('o.estado', ESTADOS_ABIERTOS as string[]).where('o.vence_en', '<', hoy),
        )
        .if(filtros.vencida === false, (q) =>
            q.where((w) =>
                w.whereNotIn('o.estado', ESTADOS_ABIERTOS as string[]).orWhere('o.vence_en', '>=', hoy),
            ),
        )
        .if(filtros.desde, (q) => q.where('o.vence_en', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('o.vence_en', '<=', filtros.hasta!))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('o.empresa_id', ids))
    if (filtros.cursor) {
        const [vence, id] = String(decodificarCursor(filtros.cursor)).split('#')
        consulta.whereRaw('(o.vence_en, o.id) > (?::date, ?::bigint)', [vence ?? '', Number(id)])
    }
    const filas = (await consulta
        .orderBy([
            { column: 'o.vence_en', order: 'asc' },
            { column: 'o.id', order: 'asc' },
        ])
        .limit(limite + 1)) as Array<Record<string, unknown>>
    const hayMas = filas.length > limite
    const data = (hayMas ? filas.slice(0, limite) : filas).map((f) =>
        vistaObligacion(normalizarObligacion(f), hoy),
    )
    const ultima = data.at(-1)
    return {
        data,
        nextCursor: hayMas && ultima ? codificarCursor(`${ultima.vence_en}#${ultima.id}`) : null,
    }
}

export async function verObligacion(id: number, hoy: string, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('fiscal.obligaciones as o')
        .where('o.id', id)
        .select(COLUMNAS_OBLIGACION)
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`La obligación ${id} no existe`)
    return vistaObligacion(normalizarObligacion(fila), hoy)
}

export { IMPUESTOS_OBLIGACION }
