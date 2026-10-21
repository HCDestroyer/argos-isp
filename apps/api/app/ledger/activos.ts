import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { NoEncontrado, Problema } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { valorParametro } from '#fiscal/parametros'
import { CLASES_ACTIVO, CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import type { ClaseActivo } from '#ledger/compras'

/**
 * Activos fijos (contrato de localización fiscal §10.10, fase 5): lectura y cálculo. Las acciones
 * (`activos.registrar`, `activos.depreciar`, `activos.dar_de_baja`) viven en `actions/`.
 *
 * - Método **lineal** (LAT, art. 28; inv. A.2): cuota mensual = (costo − residual) × tasa anual / 12,
 *   redondeada a centavos; la última cuota completa lo depreciable (costo − residual − depreciación
 *   inicial). La tasa no pasa del tope legal de su clase (parámetro `depreciacion`; 422
 *   `tasa_sobre_tope`).
 * - Empieza el mes del alta o el siguiente (`depreciacion_inicio`, por defecto `mes_siguiente`;
 *   confirmar con contador). El mes de la baja ya no se deprecia.
 * - Cuentas por clase: `1.2.01.NN` (costo), `1.2.02.NN` (depreciación acumulada) y `5.3.01
 *   Depreciaciones` (gasto).
 */

/**
 * Lock por activo (`pg_advisory_xact_lock(LOCK_ACTIVO, activo_id)`): lo toman la depreciación, la
 * baja y la anulación de la compra que lo dio de alta (observación del auditor, fase 5), así una
 * cuota nunca se registra sobre un activo que otra transacción está dando de baja o anulando.
 */
export const LOCK_ACTIVO = 3015

/**
 * La cuota `q` está vigente: su asiento no fue revertido (H20: una baja retroactiva revierte las
 * cuotas del mes de la baja en adelante; la fila de la cuota queda, insert-only, con su reverso).
 */
export const CUOTA_VIGENTE =
    'NOT EXISTS (SELECT 1 FROM ledger.asientos qr WHERE qr.reversa_de = q.asiento_id)'

export function sumarMeses(periodo: string, meses: number): string {
    return DateTime.fromISO(periodo, { zone: 'utc' }).plus({ months: meses }).toISODate()!
}

export function finDeMes(periodo: string): string {
    return DateTime.fromISO(periodo, { zone: 'utc' }).endOf('month').toISODate()!
}

/** Mes anterior al actual (Guatemala): hasta dónde corren los crons de cuotas. */
export function mesCerradoAnterior(): string {
    return sumarMeses(inicioDeMes(hoyGuatemala()), -1)
}

/**
 * Fecha del asiento de una cuota del mes: su último día. Si está cerrado o bloqueado, el asiento
 * se registra con `trasladar_si_bloqueado` y va al primer día abierto con esta fecha en
 * `fecha_documento` (§10.4).
 */
export function fechaDeCuota(mes: string): string {
    return finDeMes(mes)
}

export interface CuentasClase {
    activo: number
    depreciacion: number
    gasto: number
}

/** Cuentas del libro de una clase de activo (422 si la clase no existe). */
export async function cuentasDeClase(
    cliente: QueryClientContract,
    clase: ClaseActivo,
): Promise<CuentasClase> {
    const definicion = CLASES_ACTIVO.find((c) => c.clave === clase)
    if (!definicion) {
        throw new Problema(422, 'validacion', 'Datos inválidos', `La clase de activo ${clase} no existe`, [
            {
                field: 'clase',
                message: `Clases: ${CLASES_ACTIVO.map((c) => c.clave).join(', ')}`,
                rule: 'clase_activo',
            },
        ])
    }
    const codigos = [
        `${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.${definicion.sufijo}`,
        `${CUENTAS_GT.DEPRECIACION_ACUMULADA}.${definicion.sufijo}`,
        CUENTAS_GT.DEPRECIACIONES,
    ]
    const filas = (await cliente
        .from('ledger.cuentas')
        .where('pais', PAIS_PLAN)
        .whereIn('codigo', codigos)
        .select('id', 'codigo')) as Array<{ id: number; codigo: string }>
    const id = (codigo: string) => Number(filas.find((f) => f.codigo === codigo)!.id)
    return { activo: id(codigos[0]!), depreciacion: id(codigos[1]!), gasto: id(codigos[2]!) }
}

/**
 * Tasa anual de la clase: la pedida (≤ tope legal) o el tope vigente en la fecha del alta.
 */
export async function tasaDeClase(
    cliente: QueryClientContract,
    empresaId: number,
    clase: ClaseActivo,
    fecha: string,
    pedida?: string | null,
    campo = 'tasa_anual',
): Promise<string> {
    const topes = await valorParametro<Record<string, string>>(empresaId, 'depreciacion', fecha, cliente)
    const tope = dec(topes[clase] ?? '0')
    if (pedida === undefined || pedida === null || pedida === '') return tope.toFixed(2)
    const tasa = dec(pedida)
    if (tasa.lte(0) || tasa.gt(tope)) {
        throw new Problema(
            422,
            'tasa_sobre_tope',
            'Tasa sobre el tope legal',
            `La tasa de depreciación de ${clase} no pasa del ${tope.toFixed(2)} % anual (LAT, art. 28)`,
            [{ field: campo, message: `Tope: ${tope.toFixed(2)} %`, rule: 'tasa_sobre_tope' }],
        )
    }
    return tasa.toFixed(2)
}

/** Primer mes de depreciación según `depreciacion_inicio` vigente al alta. */
export async function inicioDepreciacion(
    cliente: QueryClientContract,
    empresaId: number,
    fechaAlta: string,
): Promise<string> {
    const regla = await valorParametro<string>(empresaId, 'depreciacion_inicio', fechaAlta, cliente).catch(
        () => 'mes_siguiente',
    )
    const mes = inicioDeMes(fechaAlta)
    return regla === 'mes_alta' ? mes : sumarMeses(mes, 1)
}

/** Cuota mensual de un activo. */
export function cuotaMensual(activo: { costo: string; valor_residual: string; tasa_anual: string }): Dec {
    return redondear(dec(activo.costo).minus(activo.valor_residual).times(activo.tasa_anual).div(1200))
}

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface ActivoVista {
    id: number
    empresa_id: number
    clase: ClaseActivo
    descripcion: string
    serie: string | null
    ubicacion: string | null
    compra_id: number | null
    compra_linea_id: number | null
    fecha_alta: string
    inicio_depreciacion: string
    costo: string
    valor_residual: string
    depreciacion_inicial: string
    tasa_anual: string
    cuota_mensual: string
    cuenta_activo_codigo: string
    cuenta_depreciacion_codigo: string
    /** depreciación inicial + Σ cuotas vigentes (sin las revertidas por una baja retroactiva) */
    depreciacion_acumulada: string
    valor_libros: string
    cuotas: number
    ultima_cuota: string | null
    estado: 'vigente' | 'dado_de_baja'
    baja: {
        fecha: string
        tipo: 'venta' | 'retiro' | 'anulacion'
        motivo: string
        precio_venta: string
        valor_libros: string
        asiento_id: number | null
    } | null
    registrado_por: number | null
    created_at: Date
}

function consultaActivos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.activos as ac')
        .join('ledger.cuentas as ca', 'ca.id', 'ac.cuenta_activo_id')
        .join('ledger.cuentas as cd', 'cd.id', 'ac.cuenta_depreciacion_id')
        .leftJoin('ledger.activos_bajas as b', 'b.activo_id', 'ac.id')
        .select(
            'ac.id',
            'ac.empresa_id',
            'ac.clase',
            'ac.descripcion',
            'ac.serie',
            'ac.ubicacion',
            'ac.compra_id',
            'ac.compra_linea_id',
            cliente.raw(`to_char(ac.fecha_alta, 'YYYY-MM-DD') as fecha_alta`),
            cliente.raw(`to_char(ac.inicio_depreciacion, 'YYYY-MM-DD') as inicio_depreciacion`),
            'ac.costo',
            'ac.valor_residual',
            'ac.depreciacion_inicial',
            'ac.tasa_anual',
            'ca.codigo as cuenta_activo_codigo',
            'cd.codigo as cuenta_depreciacion_codigo',
            cliente.raw(
                `(ac.depreciacion_inicial + coalesce((SELECT sum(q.monto) FROM ledger.activos_cuotas q WHERE q.activo_id = ac.id AND ${CUOTA_VIGENTE}), 0))::text as depreciacion_acumulada`,
            ),
            cliente.raw(
                `(SELECT count(*)::int FROM ledger.activos_cuotas q WHERE q.activo_id = ac.id AND ${CUOTA_VIGENTE}) as cuotas`,
            ),
            cliente.raw(
                `(SELECT to_char(max(q.mes), 'YYYY-MM-DD') FROM ledger.activos_cuotas q WHERE q.activo_id = ac.id AND ${CUOTA_VIGENTE}) as ultima_cuota`,
            ),
            cliente.raw(`to_char(b.fecha, 'YYYY-MM-DD') as baja_fecha`),
            'b.tipo as baja_tipo',
            'b.motivo as baja_motivo',
            'b.precio_venta as baja_precio_venta',
            'b.valor_libros as baja_valor_libros',
            'b.asiento_id as baja_asiento_id',
            'ac.registrado_por',
            'ac.created_at',
        )
}

function normalizar(f: Record<string, unknown>): ActivoVista {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    const acumulada = dec(String(f.depreciacion_acumulada))
    return {
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        clase: f.clase as ClaseActivo,
        descripcion: String(f.descripcion),
        serie: (f.serie as string | null) ?? null,
        ubicacion: (f.ubicacion as string | null) ?? null,
        compra_id: n(f.compra_id),
        compra_linea_id: n(f.compra_linea_id),
        fecha_alta: String(f.fecha_alta),
        inicio_depreciacion: String(f.inicio_depreciacion),
        costo: String(f.costo),
        valor_residual: String(f.valor_residual),
        depreciacion_inicial: String(f.depreciacion_inicial),
        tasa_anual: String(f.tasa_anual),
        cuota_mensual: aTexto(
            cuotaMensual({
                costo: String(f.costo),
                valor_residual: String(f.valor_residual),
                tasa_anual: String(f.tasa_anual),
            }),
        ),
        cuenta_activo_codigo: String(f.cuenta_activo_codigo),
        cuenta_depreciacion_codigo: String(f.cuenta_depreciacion_codigo),
        depreciacion_acumulada: aTexto(acumulada),
        valor_libros: aTexto(dec(String(f.costo)).minus(acumulada)),
        cuotas: Number(f.cuotas),
        ultima_cuota: (f.ultima_cuota as string | null) ?? null,
        estado: f.baja_tipo ? 'dado_de_baja' : 'vigente',
        baja: f.baja_tipo
            ? {
                  fecha: String(f.baja_fecha),
                  tipo: f.baja_tipo as 'venta' | 'retiro' | 'anulacion',
                  motivo: String(f.baja_motivo),
                  precio_venta: String(f.baja_precio_venta),
                  valor_libros: String(f.baja_valor_libros),
                  asiento_id: n(f.baja_asiento_id),
              }
            : null,
        registrado_por: n(f.registrado_por),
        created_at: f.created_at as Date,
    }
}

export async function verActivo(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaActivos(cliente).where('ac.id', id).first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El activo ${id} no existe`)
    return normalizar(fila)
}

export interface FiltrosActivos extends OpcionesPaginacion {
    clase?: ClaseActivo
    estado?: 'vigente' | 'dado_de_baja'
    compra_id?: number
}

export async function listarActivos(filtros: FiltrosActivos, empresas: number[] | null) {
    const consulta = consultaActivos(db.connection())
        .if(filtros.clase, (q) => q.where('ac.clase', filtros.clase!))
        .if(filtros.compra_id, (q) => q.where('ac.compra_id', filtros.compra_id!))
        .if(filtros.estado === 'vigente', (q) => q.whereNull('b.id'))
        .if(filtros.estado === 'dado_de_baja', (q) => q.whereNotNull('b.id'))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('ac.empresa_id', ids))
    const pagina = await paginar<Record<string, unknown>>(consulta, filtros, { columna: 'ac.id' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}

export async function empresaDeActivo(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('ledger.activos').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El activo ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/** Depreciación acumulada (inicial + cuotas) de un activo. */
export async function acumuladaDe(cliente: QueryClientContract, activoId: number): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.activos as ac')
        .where('ac.id', activoId)
        .select(
            cliente.raw(
                `(ac.depreciacion_inicial + coalesce((SELECT sum(q.monto) FROM ledger.activos_cuotas q WHERE q.activo_id = ac.id AND ${CUOTA_VIGENTE}), 0))::text as total`,
            ),
        )
        .first()) as { total: string } | null
    return fila ? dec(fila.total) : CERO
}
