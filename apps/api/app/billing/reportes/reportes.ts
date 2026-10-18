import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { aTexto, dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS, type ClaveCategoriaEgreso } from '#ledger/plan_cuentas'
import type { MetodoPago } from '#shared/eventos'
import {
    COLUMNAS_EMPRESA,
    armarReporte,
    definirColumnas,
    porcentaje,
    type Fila,
    type Reporte,
} from '#billing/reportes/definicion'

/**
 * Reportes de facturación y del libro (semana 2). SQL de solo lectura sobre las tablas fuente;
 * cada uno cuadra contra el libro (ver `tests/billing/reportes.spec.ts`):
 *
 * | Reporte | Cuadre |
 * | --- | --- |
 * | `cartera-vencida` | Σ total = saldo del auxiliar CxC |
 * | `ingresos` | Σ monto = débitos a Caja/Bancos/Comisiones de los asientos de pago vigentes |
 * | `facturado-vs-cobrado` | Σ pendiente = saldo CxC; Σ facturado = cargos CxC no revertidos |
 * | `cobranza-diaria` | Σ monto = Σ `ingresos` del mismo rango |
 * | `cierres-caja` | Σ diferencia = asientos `cierre_caja` (sobrantes − faltantes) |
 * | `iva` | `iva_neto` = `iva_libro` (cuenta 2.1.02) por mes |
 * | `egresos` | Σ monto = cuentas de gasto de los asientos `egreso` vigentes |
 *
 * Fechas: las de negocio son días de Guatemala (`created_at AT TIME ZONE 'America/Guatemala'`);
 * las contables (`asientos.fecha`, `egresos.fecha`) ya lo son.
 */

const GT = `'${ZONA_NEGOCIO}'`
const diaGt = (columna: string) => `(${columna} AT TIME ZONE ${GT})::date`
const mesGt = (columna: string) => `to_char(${columna} AT TIME ZONE ${GT}, 'YYYY-MM')`

/** Rango por defecto: los últimos 12 meses (desde el día 1 del mes de hace 11 meses). */
export function rangoPorDefecto(filtros: { desde?: string; hasta?: string }) {
    const hasta = filtros.hasta ?? hoyGuatemala()
    const desde =
        filtros.desde ??
        DateTime.fromISO(hasta, { zone: 'utc' }).startOf('month').minus({ months: 11 }).toISODate()!
    return { desde, hasta }
}

/** Alcance por zona del cliente y router del servicio (alias `c` y `s`). */
const dimensionesClienteServicio: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) => q.whereIn('s.router_id', ids),
}

/**
 * Empresas del reporte (multiempresa): `empresas` filtra (null = todas) y `consolidado` agrega
 * las columnas `empresa_id` y `empresa` (una fila por empresa y grupo; el total es el del grupo).
 */
export interface EmpresasReporte {
    empresas: number[] | null
    consolidado: boolean
}

export const UNA_EMPRESA: EmpresasReporte = { empresas: null, consolidado: false }

const nombreEmpresa = (columna: string) =>
    `(select e.nombre_comercial from core.empresas e where e.id = ${columna})`

/** Filtra por empresa y, en el consolidado, agrupa y selecciona la empresa. */
function porEmpresa<Q extends { whereIn: any; groupBy: any; select: any; orderBy: any }>(
    consulta: Q,
    columna: string,
    op: EmpresasReporte,
    agrupar = true,
): Q {
    if (op.empresas !== null) consulta.whereIn(columna, op.empresas)
    if (op.consolidado) {
        if (agrupar) consulta.groupBy(columna)
        consulta.select(db.raw(`${columna} as empresa_id`), db.raw(`${nombreEmpresa(columna)} as empresa`))
        consulta.orderBy(columna, 'asc')
    }
    return consulta
}

function columnasCon<C extends readonly import('#billing/reportes/definicion').Columna[]>(
    op: EmpresasReporte,
    columnas: C,
) {
    return op.consolidado ? [...COLUMNAS_EMPRESA, ...columnas] : columnas
}

function filtrosCon(op: EmpresasReporte, filtros: Record<string, unknown>) {
    return { ...filtros, empresas: op.consolidado ? 'todas' : (op.empresas ?? null) }
}

function dinero(valor: unknown): string {
    return aTexto(dec((valor as string | null) ?? '0'))
}

export interface FiltrosCliente {
    cliente_id?: number
    zona_id?: number
    router_id?: number
    plan_id?: number
}

/*
|--------------------------------------------------------------------------
| Cartera vencida por antigüedad
|--------------------------------------------------------------------------
*/

export const COLUMNAS_CARTERA = definirColumnas([
    { clave: 'grupo_id', titulo: 'Id', tipo: 'id', nulable: true },
    { clave: 'grupo', titulo: 'Grupo', tipo: 'texto' },
    { clave: 'facturas', titulo: 'Facturas', tipo: 'entero' },
    { clave: 'por_vencer', titulo: 'Por vencer', tipo: 'dinero' },
    { clave: 'dias_0_30', titulo: '0-30 días', tipo: 'dinero' },
    { clave: 'dias_31_60', titulo: '31-60 días', tipo: 'dinero' },
    { clave: 'dias_61_90', titulo: '61-90 días', tipo: 'dinero' },
    { clave: 'dias_mas_90', titulo: 'Más de 90 días', tipo: 'dinero' },
    { clave: 'vencido', titulo: 'Total vencido', tipo: 'dinero' },
    { clave: 'total', titulo: 'Total pendiente', tipo: 'dinero' },
])

export type AgruparCartera = 'cliente' | 'zona' | 'router' | 'plan'

export interface FiltrosCartera extends FiltrosCliente {
    corte?: string
    agrupar?: AgruparCartera
}

const GRUPOS_CARTERA: Record<AgruparCartera, { id: string; nombre: string; vacio: string }> = {
    cliente: { id: 'c.id', nombre: 'c.nombre', vacio: 'Sin cliente' },
    zona: { id: 'c.zona_id', nombre: 'z.nombre', vacio: 'Sin zona' },
    router: { id: 's.router_id', nombre: 'r.nombre', vacio: 'Sin router' },
    plan: { id: 's.plan_id', nombre: 'pl.nombre', vacio: 'Sin plan' },
}

/**
 * Saldo pendiente de las facturas (servicio y mora) por días de atraso al `corte` (hoy por
 * defecto): `dias = corte − vence_en`; ≤ 0 por vencer, 1–30, 31–60, 61–90 y más de 90. Es el saldo
 * actual de cada factura (lo pagado hasta hoy), agrupado por cliente, zona, router o plan.
 */
export async function carteraVencida(
    filtros: FiltrosCartera,
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const corte = filtros.corte ?? hoyGuatemala()
    const agrupar = filtros.agrupar ?? 'cliente'
    const grupo = GRUPOS_CARTERA[agrupar]
    const dias = `(?::date - f.vence_en)`
    const tramo = (condicion: string, alias: string) =>
        db.raw(
            `coalesce(sum(case when ${condicion} then f.total - f.pagado else 0 end), 0)::text as ${alias}`,
            [corte],
        )
    const consulta = db
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .leftJoin('core.zonas as z', 'z.id', 'c.zona_id')
        .leftJoin('network.routers as r', 'r.id', 's.router_id')
        .leftJoin('network.planes as pl', 'pl.id', 's.plan_id')
        .whereIn('f.estado', ['emitida', 'parcial', 'vencida'])
        .whereRaw('f.total > f.pagado')
        .if(filtros.cliente_id, (q) => q.where('f.cliente_id', filtros.cliente_id!))
        .if(filtros.zona_id, (q) => q.where('c.zona_id', filtros.zona_id!))
        .if(filtros.router_id, (q) => q.where('s.router_id', filtros.router_id!))
        .if(filtros.plan_id, (q) => q.where('s.plan_id', filtros.plan_id!))
        .groupBy(grupo.id, grupo.nombre)
        .orderByRaw(`${grupo.nombre} asc nulls last, ${grupo.id} asc nulls last`)
        .select(
            db.raw(`${grupo.id} as grupo_id`),
            db.raw(`coalesce(${grupo.nombre}, ?) as grupo`, [grupo.vacio]),
            db.raw('count(*)::int as facturas'),
            tramo(`${dias} <= 0`, 'por_vencer'),
            tramo(`${dias} between 1 and 30`, 'dias_0_30'),
            tramo(`${dias} between 31 and 60`, 'dias_31_60'),
            tramo(`${dias} between 61 and 90`, 'dias_61_90'),
            tramo(`${dias} > 90`, 'dias_mas_90'),
            tramo(`${dias} > 0`, 'vencido'),
            db.raw('coalesce(sum(f.total - f.pagado), 0)::text as total'),
        )
    filtrarPorAlcance(consulta, alcance, dimensionesClienteServicio)
    porEmpresa(consulta, 'f.empresa_id', op)
    const filas = ((await consulta) as Fila[]).map((fila) => ({
        ...fila,
        ...Object.fromEntries(
            ['por_vencer', 'dias_0_30', 'dias_31_60', 'dias_61_90', 'dias_mas_90', 'vencido', 'total'].map(
                (k) => [k, dinero(fila[k])],
            ),
        ),
    }))
    return armarReporte({
        reporte: 'cartera-vencida',
        titulo: 'Cartera vencida por antigüedad',
        columnas: columnasCon(op, COLUMNAS_CARTERA),
        filas,
        filtros: filtrosCon(op, { ...filtros, corte, agrupar }),
    })
}

/*
|--------------------------------------------------------------------------
| Ingresos por periodo y método
|--------------------------------------------------------------------------
*/

export const COLUMNAS_INGRESOS = definirColumnas([
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'metodo', titulo: 'Método', tipo: 'texto' },
    { clave: 'pagos', titulo: 'Pagos', tipo: 'entero' },
    { clave: 'monto', titulo: 'Monto', tipo: 'dinero' },
    { clave: 'comision', titulo: 'Comisión', tipo: 'dinero' },
    { clave: 'neto', titulo: 'Neto', tipo: 'dinero' },
    { clave: 'pagos_importados', titulo: 'Pagos importados', tipo: 'entero', agregada: true },
    { clave: 'monto_importado', titulo: 'Monto importado', tipo: 'dinero', agregada: true },
])

/** `sistema`: lo registrado en ArgosIsp; `importado`: carga histórica de otro sistema. */
export type OrigenReporte = 'sistema' | 'importado'

export interface FiltrosIngresos extends FiltrosCliente {
    desde?: string
    hasta?: string
    metodo?: MetodoPago
    agrupar?: 'mes' | 'dia'
    origen?: OrigenReporte
}

/**
 * Pagos vigentes (registrados, no anulados ni pendientes de verificación) por mes (o día) y método.
 * Incluye los pagos históricos importados en su mes de origen (decisión del PM): su fecha es la
 * del sistema de origen. `pagos_importados`/`monto_importado` separan esa parte; `origen` filtra.
 */
export async function ingresos(
    filtros: FiltrosIngresos,
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const { desde, hasta } = rangoPorDefecto(filtros)
    const agrupar = filtros.agrupar ?? 'mes'
    const periodo =
        agrupar === 'dia' ? `to_char(${diaGt('p.created_at')}, 'YYYY-MM-DD')` : mesGt('p.created_at')
    const consulta = db
        .from('billing.pagos as p')
        .join('core.clientes as c', 'c.id', 'p.cliente_id')
        .where('p.estado', 'registrado')
        .whereRaw(`${diaGt('p.created_at')} between ? and ?`, [desde, hasta])
        .if(filtros.origen, (q) => q.where('p.historico', filtros.origen === 'importado'))
        .if(filtros.metodo, (q) => q.where('p.metodo', filtros.metodo!))
        .if(filtros.cliente_id, (q) => q.where('p.cliente_id', filtros.cliente_id!))
        .if(filtros.zona_id, (q) => q.where('c.zona_id', filtros.zona_id!))
        .groupByRaw(`${periodo}, p.metodo`)
        .orderByRaw(`${periodo} asc, p.metodo asc`)
        .select(
            db.raw(`${periodo} as periodo`),
            'p.metodo',
            db.raw('count(*)::int as pagos'),
            db.raw('sum(p.monto)::text as monto'),
            db.raw('sum(p.comision)::text as comision'),
            db.raw('sum(p.monto - p.comision)::text as neto'),
            db.raw('(count(*) filter (where p.historico))::int as pagos_importados'),
            db.raw('coalesce(sum(p.monto) filter (where p.historico), 0)::text as monto_importado'),
        )
    filtrarPorAlcance(consulta, alcance, { zona: (q, ids) => q.whereIn('c.zona_id', ids) })
    porEmpresa(consulta, 'p.empresa_id', op)
    const filas = ((await consulta) as Fila[]).map((f) => ({
        ...f,
        monto: dinero(f.monto),
        comision: dinero(f.comision),
        neto: dinero(f.neto),
        monto_importado: dinero(f.monto_importado),
    }))
    return armarReporte({
        reporte: 'ingresos',
        titulo: 'Ingresos por periodo y método',
        columnas: columnasCon(op, COLUMNAS_INGRESOS),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta, agrupar }),
    })
}

/*
|--------------------------------------------------------------------------
| Facturado vs cobrado
|--------------------------------------------------------------------------
*/

export const COLUMNAS_FACTURADO = definirColumnas([
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'facturas', titulo: 'Facturas', tipo: 'entero' },
    { clave: 'facturado', titulo: 'Facturado', tipo: 'dinero' },
    { clave: 'cobrado', titulo: 'Cobrado', tipo: 'dinero' },
    { clave: 'pendiente', titulo: 'Pendiente', tipo: 'dinero' },
    { clave: 'cobranza_pct', titulo: '% cobrado', tipo: 'porcentaje' },
    { clave: 'acreditado', titulo: 'Notas de crédito', tipo: 'dinero', agregada: true },
    { clave: 'facturado_importado', titulo: 'Facturado importado', tipo: 'dinero', agregada: true },
    { clave: 'cobrado_importado', titulo: 'Cobrado importado', tipo: 'dinero', agregada: true },
])

/** Lo acreditado por notas de crédito a la factura `f` (parte de `f.pagado` que no es cobro). */
const ACREDITADO = '(select coalesce(sum(n.monto), 0) from billing.notas_credito n where n.factura_id = f.id)'

export interface FiltrosFacturado extends FiltrosCliente {
    desde?: string
    hasta?: string
    tipo?: 'servicio' | 'mora'
    origen?: OrigenReporte
}

/**
 * Por periodo de la factura (mes de `periodo`): lo facturado (facturas no anuladas, IVA incluido),
 * lo cobrado de esas facturas hasta hoy y lo pendiente. `cobrado` = pagos y saldos a favor
 * aplicados (también los pagos históricos importados); las notas de crédito no son cobro y van en
 * `acreditado` (`pendiente = facturado − cobrado − acreditado`). Las facturas importadas
 * (`clave_externa`, con sus pagos históricos) cuentan en el mes de su periodo de origen;
 * `facturado_importado`/`cobrado_importado` separan esa parte y `origen` filtra.
 */
export async function facturadoVsCobrado(
    filtros: FiltrosFacturado,
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const { desde, hasta } = rangoPorDefecto(filtros)
    const periodo = `to_char(f.periodo, 'YYYY-MM')`
    const consulta = db
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .whereNot('f.estado', 'anulada')
        .whereRaw(`f.periodo between date_trunc('month', ?::date) and ?::date`, [desde, hasta])
        .if(filtros.tipo, (q) => q.where('f.tipo', filtros.tipo!))
        .if(filtros.origen === 'importado', (q) => q.whereNotNull('f.clave_externa'))
        .if(filtros.origen === 'sistema', (q) => q.whereNull('f.clave_externa'))
        .if(filtros.cliente_id, (q) => q.where('f.cliente_id', filtros.cliente_id!))
        .if(filtros.zona_id, (q) => q.where('c.zona_id', filtros.zona_id!))
        .if(filtros.router_id, (q) => q.where('s.router_id', filtros.router_id!))
        .if(filtros.plan_id, (q) => q.where('s.plan_id', filtros.plan_id!))
        .groupByRaw(periodo)
        .orderByRaw(`${periodo} asc`)
        .select(
            db.raw(`${periodo} as periodo`),
            db.raw('count(*)::int as facturas'),
            db.raw('sum(f.total)::text as facturado'),
            db.raw(`sum(f.pagado - ${ACREDITADO})::text as cobrado`),
            db.raw('sum(f.total - f.pagado)::text as pendiente'),
            db.raw(`coalesce(sum(${ACREDITADO}), 0)::text as acreditado`),
            db.raw(
                'coalesce(sum(f.total) filter (where f.clave_externa is not null), 0)::text as facturado_importado',
            ),
            db.raw(
                `coalesce(sum(f.pagado - ${ACREDITADO}) filter (where f.clave_externa is not null), 0)::text as cobrado_importado`,
            ),
        )
    filtrarPorAlcance(consulta, alcance, dimensionesClienteServicio)
    porEmpresa(consulta, 'f.empresa_id', op)
    const filas = ((await consulta) as Fila[]).map((f) => ({
        ...f,
        facturado: dinero(f.facturado),
        cobrado: dinero(f.cobrado),
        pendiente: dinero(f.pendiente),
        cobranza_pct: porcentaje(f.cobrado as string, f.facturado as string),
        acreditado: dinero(f.acreditado),
        facturado_importado: dinero(f.facturado_importado),
        cobrado_importado: dinero(f.cobrado_importado),
    }))
    const reporte = armarReporte({
        reporte: 'facturado-vs-cobrado',
        titulo: 'Facturado vs cobrado',
        columnas: columnasCon(op, COLUMNAS_FACTURADO),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta }),
    })
    reporte.totales.cobranza_pct = porcentaje(
        reporte.totales.cobrado as string,
        reporte.totales.facturado as string,
    )
    return reporte
}

/*
|--------------------------------------------------------------------------
| Cobranza diaria y cierres de caja
|--------------------------------------------------------------------------
*/

export const COLUMNAS_COBRANZA = definirColumnas([
    { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
    { clave: 'metodo', titulo: 'Método', tipo: 'texto' },
    { clave: 'caja_id', titulo: 'Caja', tipo: 'id', nulable: true },
    { clave: 'caja', titulo: 'Nombre de caja', tipo: 'texto', nulable: true },
    { clave: 'pagos', titulo: 'Pagos', tipo: 'entero' },
    { clave: 'monto', titulo: 'Cobrado', tipo: 'dinero' },
    { clave: 'anulados', titulo: 'Anulados', tipo: 'entero' },
    { clave: 'monto_anulado', titulo: 'Monto anulado', tipo: 'dinero' },
])

export interface FiltrosCobranza {
    desde?: string
    hasta?: string
    caja_id?: number
    metodo?: MetodoPago
}

/** Cobros por día (Guatemala), método y caja; los anulados aparte (no suman en `monto`). */
export async function cobranzaDiaria(
    filtros: FiltrosCobranza,
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const hasta = filtros.hasta ?? hoyGuatemala()
    const desde = filtros.desde ?? DateTime.fromISO(hasta, { zone: 'utc' }).startOf('month').toISODate()!
    const dia = diaGt('p.created_at')
    const consulta = db
        .from('billing.pagos as p')
        .leftJoin('ledger.cajas as cj', 'cj.id', 'p.caja_id')
        .whereIn('p.estado', ['registrado', 'anulado'])
        .whereRaw(`${dia} between ? and ?`, [desde, hasta])
        .if(filtros.caja_id, (q) => q.where('p.caja_id', filtros.caja_id!))
        .if(filtros.metodo, (q) => q.where('p.metodo', filtros.metodo!))
        .groupByRaw(`${dia}, p.metodo, p.caja_id, cj.nombre`)
        .orderByRaw(`${dia} asc, p.metodo asc, cj.nombre asc nulls first`)
        .select(
            db.raw(`to_char(${dia}, 'YYYY-MM-DD') as fecha`),
            'p.metodo',
            'p.caja_id',
            'cj.nombre as caja',
            db.raw(`count(*) filter (where p.estado = 'registrado')::int as pagos`),
            db.raw(`coalesce(sum(p.monto) filter (where p.estado = 'registrado'), 0)::text as monto`),
            db.raw(`count(*) filter (where p.estado = 'anulado')::int as anulados`),
            db.raw(`coalesce(sum(p.monto) filter (where p.estado = 'anulado'), 0)::text as monto_anulado`),
        )
    filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('p.caja_id', ids) })
    porEmpresa(consulta, 'p.empresa_id', op)
    const filas = ((await consulta) as Fila[]).map((f) => ({
        ...f,
        monto: dinero(f.monto),
        monto_anulado: dinero(f.monto_anulado),
    }))
    return armarReporte({
        reporte: 'cobranza-diaria',
        titulo: 'Cobranza diaria',
        columnas: columnasCon(op, COLUMNAS_COBRANZA),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta }),
    })
}

export const COLUMNAS_CIERRES = definirColumnas([
    { clave: 'turno_id', titulo: 'Turno', tipo: 'id' },
    { clave: 'caja_id', titulo: 'Caja', tipo: 'id' },
    { clave: 'caja', titulo: 'Nombre de caja', tipo: 'texto' },
    { clave: 'abierto_en', titulo: 'Abierto', tipo: 'texto' },
    { clave: 'cerrado_en', titulo: 'Cerrado', tipo: 'texto' },
    { clave: 'abierto_por', titulo: 'Abrió', tipo: 'texto', nulable: true },
    { clave: 'cerrado_por', titulo: 'Cerró', tipo: 'texto', nulable: true },
    { clave: 'fondo_inicial', titulo: 'Fondo inicial', tipo: 'dinero' },
    { clave: 'cobrado', titulo: 'Cobrado', tipo: 'dinero' },
    { clave: 'egresos', titulo: 'Egresos', tipo: 'dinero' },
    { clave: 'esperado', titulo: 'Esperado', tipo: 'dinero' },
    { clave: 'contado', titulo: 'Contado', tipo: 'dinero' },
    { clave: 'diferencia', titulo: 'Diferencia', tipo: 'dinero' },
    { clave: 'motivo', titulo: 'Motivo', tipo: 'texto', nulable: true },
])

/** Turnos cerrados en el rango (día de cierre en Guatemala) con esperado, contado y diferencia. */
export async function cierresCaja(
    filtros: FiltrosCobranza,
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const hasta = filtros.hasta ?? hoyGuatemala()
    const desde = filtros.desde ?? DateTime.fromISO(hasta, { zone: 'utc' }).startOf('month').toISODate()!
    const consulta = db
        .from('ledger.cajas_turnos as t')
        .join('ledger.cajas as cj', 'cj.id', 't.caja_id')
        .leftJoin('core.usuarios as ua', 'ua.id', 't.abierto_por')
        .leftJoin('core.usuarios as uc', 'uc.id', 't.cerrado_por')
        .whereNotNull('t.cerrado_en')
        .whereRaw(`${diaGt('t.cerrado_en')} between ? and ?`, [desde, hasta])
        .if(filtros.caja_id, (q) => q.where('t.caja_id', filtros.caja_id!))
        .orderBy('t.cerrado_en', 'asc')
        .orderBy('t.id', 'asc')
        .select(
            't.id as turno_id',
            't.caja_id',
            'cj.nombre as caja',
            db.raw(`to_char(t.abierto_en AT TIME ZONE ${GT}, 'YYYY-MM-DD HH24:MI') as abierto_en`),
            db.raw(`to_char(t.cerrado_en AT TIME ZONE ${GT}, 'YYYY-MM-DD HH24:MI') as cerrado_en`),
            'ua.nombre as abierto_por',
            'uc.nombre as cerrado_por',
            't.fondo_inicial',
            db.raw(
                `(select coalesce(sum(p.monto - p.retenido), 0) from billing.pagos p where p.turno_id = t.id and p.estado <> 'anulado')::text as cobrado`,
            ),
            db.raw(
                `(select coalesce(sum(e.monto), 0) from ledger.egresos e where e.turno_id = t.id
                   and not exists (select 1 from ledger.egresos_anulaciones an where an.egreso_id = e.id))::text as egresos`,
            ),
            't.esperado',
            't.contado',
            't.diferencia',
            't.motivo',
        )
    filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('t.caja_id', ids) })
    porEmpresa(consulta, 'cj.empresa_id', op, false)
    const filas = ((await consulta) as Fila[]).map((f) => ({
        ...f,
        ...Object.fromEntries(
            ['fondo_inicial', 'cobrado', 'egresos', 'esperado', 'contado', 'diferencia'].map((k) => [
                k,
                dinero(f[k]),
            ]),
        ),
    }))
    return armarReporte({
        reporte: 'cierres-caja',
        titulo: 'Cierres de caja',
        columnas: columnasCon(op, COLUMNAS_CIERRES),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta }),
        totales: { fondo_inicial: null, esperado: null, contado: null },
    })
}

/*
|--------------------------------------------------------------------------
| IVA del periodo (débito fiscal)
|--------------------------------------------------------------------------
*/

export const COLUMNAS_IVA = definirColumnas([
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'facturas', titulo: 'Facturas emitidas', tipo: 'entero' },
    { clave: 'base', titulo: 'Base gravable', tipo: 'dinero' },
    { clave: 'iva_facturado', titulo: 'IVA facturado', tipo: 'dinero' },
    { clave: 'facturas_anuladas', titulo: 'Facturas anuladas', tipo: 'entero' },
    { clave: 'base_anulada', titulo: 'Base anulada', tipo: 'dinero' },
    { clave: 'iva_anulado', titulo: 'IVA anulado', tipo: 'dinero' },
    { clave: 'notas_credito', titulo: 'Notas de crédito', tipo: 'entero', agregada: true },
    { clave: 'base_acreditada', titulo: 'Base acreditada', tipo: 'dinero', agregada: true },
    { clave: 'iva_acreditado', titulo: 'IVA acreditado', tipo: 'dinero', agregada: true },
    { clave: 'iva_neto', titulo: 'IVA débito neto', tipo: 'dinero' },
    { clave: 'iva_libro', titulo: 'Saldo del mes en 2.1.02', tipo: 'dinero' },
])

/**
 * Débito fiscal por mes contable, desde el libro: lo facturado (asientos de factura), lo anulado
 * (sus reversos, en el mes del reverso) y lo acreditado por notas de crédito (en el mes de la
 * nota). `iva_neto = facturado − anulado − acreditado`. `iva_libro` es el movimiento neto de la cuenta IVA
 * débito fiscal del mes; debe ser igual a `iva_neto`.
 */
export async function ivaDelPeriodo(
    filtros: { desde?: string; hasta?: string },
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const { desde, hasta } = rangoPorDefecto(filtros)
    // el IVA se calcula por NIT: cada empresa declara el suyo
    const empresa = op.consolidado
        ? `i.empresa_id AS empresa_id, ${nombreEmpresa('i.empresa_id')} AS empresa,`
        : ''
    const resultado = await db.rawQuery(
        `
        WITH iva AS (
            SELECT to_char(a.fecha, 'YYYY-MM') AS periodo, a.id, a.empresa_id, a.origen_tipo, a.origen_id,
                   a.reversa_de, sum(m.haber) AS haber, sum(m.debe) AS debe
              FROM ledger.movimientos m
              JOIN ledger.asientos a ON a.id = m.asiento_id
              JOIN ledger.cuentas c ON c.id = m.cuenta_id
             WHERE c.codigo = ? AND a.fecha BETWEEN date_trunc('month', ?::date) AND ?::date
               AND (?::bigint[] IS NULL OR a.empresa_id = ANY(?::bigint[]))
             GROUP BY a.id
        )
        SELECT ${empresa} i.periodo,
               count(*) FILTER (WHERE i.reversa_de IS NULL AND i.origen_tipo = 'factura')::int AS facturas,
               coalesce(sum(f.subtotal) FILTER (WHERE i.reversa_de IS NULL), 0)::text AS base,
               coalesce(sum(i.haber) FILTER (WHERE i.reversa_de IS NULL AND i.origen_tipo <> 'nota_credito'), 0)::text AS iva_facturado,
               count(*) FILTER (WHERE i.reversa_de IS NULL AND i.origen_tipo = 'nota_credito')::int AS notas_credito,
               coalesce(sum(n.subtotal) FILTER (WHERE i.reversa_de IS NULL), 0)::text AS base_acreditada,
               coalesce(sum(i.debe) FILTER (WHERE i.reversa_de IS NULL AND i.origen_tipo = 'nota_credito'), 0)::text AS iva_acreditado,
               count(*) FILTER (WHERE i.reversa_de IS NOT NULL AND i.origen_tipo = 'factura')::int AS facturas_anuladas,
               coalesce(sum(f.subtotal) FILTER (WHERE i.reversa_de IS NOT NULL), 0)::text AS base_anulada,
               coalesce(sum(i.debe) FILTER (WHERE i.reversa_de IS NOT NULL), 0)::text AS iva_anulado,
               coalesce(sum(i.haber) - sum(i.debe), 0)::text AS iva_libro
          FROM iva i
          LEFT JOIN billing.facturas f ON i.origen_tipo = 'factura' AND f.id = i.origen_id
          LEFT JOIN billing.notas_credito n ON i.origen_tipo = 'nota_credito' AND n.id = i.origen_id
         GROUP BY i.periodo${op.consolidado ? ', i.empresa_id' : ''}
         ORDER BY i.periodo${op.consolidado ? ', i.empresa_id' : ''}
        `,
        [CUENTAS.IVA_DEBITO, desde, hasta, op.empresas, op.empresas],
    )
    const filas = (resultado.rows as Fila[]).map((f) => ({
        ...f,
        base: dinero(f.base),
        iva_facturado: dinero(f.iva_facturado),
        base_anulada: dinero(f.base_anulada),
        iva_anulado: dinero(f.iva_anulado),
        base_acreditada: dinero(f.base_acreditada),
        iva_acreditado: dinero(f.iva_acreditado),
        iva_neto: aTexto(
            dec(f.iva_facturado as string)
                .minus(dec(f.iva_anulado as string))
                .minus(dec(f.iva_acreditado as string)),
        ),
        iva_libro: dinero(f.iva_libro),
    }))
    return armarReporte({
        reporte: 'iva',
        titulo: 'IVA del periodo',
        columnas: columnasCon(op, COLUMNAS_IVA),
        filas,
        filtros: filtrosCon(op, { desde, hasta }),
    })
}

/*
|--------------------------------------------------------------------------
| Promesas
|--------------------------------------------------------------------------
*/

export const COLUMNAS_PROMESAS = definirColumnas([
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'canal', titulo: 'Canal', tipo: 'texto' },
    { clave: 'creadas', titulo: 'Creadas', tipo: 'entero' },
    { clave: 'rechazadas', titulo: 'Rechazadas', tipo: 'entero' },
    { clave: 'pendientes', titulo: 'Pendientes de aprobación', tipo: 'entero' },
    { clave: 'activas', titulo: 'Activas', tipo: 'entero' },
    { clave: 'cumplidas', titulo: 'Cumplidas', tipo: 'entero' },
    { clave: 'incumplidas', titulo: 'Incumplidas', tipo: 'entero' },
    { clave: 'canceladas', titulo: 'Canceladas', tipo: 'entero' },
    { clave: 'monto_prometido', titulo: 'Monto prometido', tipo: 'dinero' },
    { clave: 'tasa_cumplimiento', titulo: '% cumplimiento', tipo: 'porcentaje' },
])

export interface FiltrosPromesasReporte extends FiltrosCliente {
    desde?: string
    hasta?: string
    canal?: 'portal' | 'ia' | 'operador' | 'supervisor'
}

/**
 * Promesas por mes de creación y canal, con su estado actual. `monto_prometido` excluye las
 * rechazadas; `tasa_cumplimiento = cumplidas / (cumplidas + incumplidas)`.
 */
export async function promesas(
    filtros: FiltrosPromesasReporte,
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const { desde, hasta } = rangoPorDefecto(filtros)
    const periodo = mesGt('p.created_at')
    const cuenta = (estado: string, alias: string) =>
        db.raw(`count(*) filter (where p.estado = ?)::int as ${alias}`, [estado])
    const consulta = db
        .from('billing.promesas as p')
        .join('core.clientes as c', 'c.id', 'p.cliente_id')
        .join('core.servicios as s', 's.id', 'p.servicio_id')
        .whereRaw(`${diaGt('p.created_at')} between ? and ?`, [desde, hasta])
        .if(filtros.canal, (q) => q.where('p.canal', filtros.canal!))
        .if(filtros.cliente_id, (q) => q.where('p.cliente_id', filtros.cliente_id!))
        .if(filtros.zona_id, (q) => q.where('c.zona_id', filtros.zona_id!))
        .if(filtros.router_id, (q) => q.where('s.router_id', filtros.router_id!))
        .if(filtros.plan_id, (q) => q.where('s.plan_id', filtros.plan_id!))
        .groupByRaw(`${periodo}, p.canal`)
        .orderByRaw(`${periodo} asc, p.canal asc`)
        .select(
            db.raw(`${periodo} as periodo`),
            'p.canal',
            db.raw('count(*)::int as creadas'),
            cuenta('rechazada', 'rechazadas'),
            cuenta('pendiente_aprobacion', 'pendientes'),
            cuenta('activa', 'activas'),
            cuenta('cumplida', 'cumplidas'),
            cuenta('incumplida', 'incumplidas'),
            cuenta('cancelada', 'canceladas'),
            db.raw(
                `coalesce(sum(p.monto) filter (where p.estado <> 'rechazada'), 0)::text as monto_prometido`,
            ),
        )
    filtrarPorAlcance(consulta, alcance, dimensionesClienteServicio)
    porEmpresa(consulta, 'p.empresa_id', op)
    const tasa = (f: Fila) => porcentaje(Number(f.cumplidas), Number(f.cumplidas) + Number(f.incumplidas))
    const filas = ((await consulta) as Fila[]).map((f) => ({
        ...f,
        monto_prometido: dinero(f.monto_prometido),
        tasa_cumplimiento: tasa(f),
    }))
    const reporte = armarReporte({
        reporte: 'promesas',
        titulo: 'Promesas de pago',
        columnas: columnasCon(op, COLUMNAS_PROMESAS),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta }),
    })
    reporte.totales.tasa_cumplimiento = tasa(reporte.totales)
    return reporte
}

/*
|--------------------------------------------------------------------------
| Altas, bajas y suspensiones
|--------------------------------------------------------------------------
*/

export const COLUMNAS_ALTAS = definirColumnas([
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'altas', titulo: 'Altas', tipo: 'entero' },
    { clave: 'bajas', titulo: 'Bajas (retiros)', tipo: 'entero' },
    { clave: 'suspensiones', titulo: 'Suspensiones', tipo: 'entero' },
    { clave: 'limitaciones', titulo: 'Limitaciones', tipo: 'entero' },
    { clave: 'reactivaciones', titulo: 'Reactivaciones', tipo: 'entero' },
    { clave: 'neto', titulo: 'Altas − bajas', tipo: 'entero' },
])

/**
 * Por mes: altas = servicios por fecha de instalación (o de alta en el sistema); bajas,
 * suspensiones, limitaciones y reactivaciones = eventos `servicio.estado_cambiado` del outbox
 * (la historia de estados del servicio).
 */
export async function altasBajas(
    filtros: { desde?: string; hasta?: string; zona_id?: number; router_id?: number; plan_id?: number },
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const { desde, hasta } = rangoPorDefecto(filtros)
    const alta = `coalesce(s.fecha_instalacion, ${diaGt('s.created_at')})`
    const altas = db
        .from('core.servicios as s')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .whereRaw(`${alta} between ? and ?`, [desde, hasta])
        .if(filtros.zona_id, (q) => q.where('c.zona_id', filtros.zona_id!))
        .if(filtros.router_id, (q) => q.where('s.router_id', filtros.router_id!))
        .if(filtros.plan_id, (q) => q.where('s.plan_id', filtros.plan_id!))
        .groupByRaw(`to_char(${alta}, 'YYYY-MM')`)
        .select(db.raw(`to_char(${alta}, 'YYYY-MM') as periodo`), db.raw('count(*)::int as altas'))
    filtrarPorAlcance(altas, alcance, dimensionesClienteServicio)
    porEmpresa(altas, 's.empresa_id', op)

    const a = `o.payload->>'a'`
    const cambios = db
        .from('audit.outbox as o')
        .join('core.servicios as s', 's.id', db.raw(`(o.payload->>'servicio_id')::bigint`))
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .where('o.evento', 'servicio.estado_cambiado')
        .whereRaw(`${diaGt('o.created_at')} between ? and ?`, [desde, hasta])
        .if(filtros.zona_id, (q) => q.where('c.zona_id', filtros.zona_id!))
        .if(filtros.router_id, (q) => q.where('s.router_id', filtros.router_id!))
        .if(filtros.plan_id, (q) => q.where('s.plan_id', filtros.plan_id!))
        .groupByRaw(mesGt('o.created_at'))
        .select(
            db.raw(`${mesGt('o.created_at')} as periodo`),
            db.raw(`count(*) filter (where ${a} = 'retirado')::int as bajas`),
            db.raw(`count(*) filter (where ${a} = 'suspendido')::int as suspensiones`),
            db.raw(`count(*) filter (where ${a} = 'limitado')::int as limitaciones`),
            db.raw(
                `count(*) filter (where ${a} = 'activo' and o.payload->>'de' in ('limitado', 'suspendido'))::int as reactivaciones`,
            ),
        )
    filtrarPorAlcance(cambios, alcance, dimensionesClienteServicio)
    porEmpresa(cambios, 's.empresa_id', op)

    const porPeriodo = new Map<string, Fila>()
    const fila = (periodo: string, empresa?: Fila) => {
        const clave = op.consolidado ? `${empresa?.empresa_id}|${periodo}` : periodo
        if (!porPeriodo.has(clave)) {
            porPeriodo.set(clave, {
                ...(op.consolidado ? { empresa_id: empresa!.empresa_id, empresa: empresa!.empresa } : {}),
                periodo,
                altas: 0,
                bajas: 0,
                suspensiones: 0,
                limitaciones: 0,
                reactivaciones: 0,
                neto: 0,
            })
        }
        return porPeriodo.get(clave)!
    }
    for (const f of (await altas) as Array<Fila & { periodo: string; altas: number }>) {
        fila(f.periodo, f).altas = f.altas
    }
    for (const f of (await cambios) as Fila[]) Object.assign(fila(f.periodo as string, f), { ...f })
    const filas = [...porPeriodo.values()]
        .sort(
            (x, y) =>
                String(x.periodo).localeCompare(String(y.periodo)) ||
                Number(x.empresa_id ?? 0) - Number(y.empresa_id ?? 0),
        )
        .map((f) => ({ ...f, neto: Number(f.altas) - Number(f.bajas) }))
    return armarReporte({
        reporte: 'altas-bajas',
        titulo: 'Altas y bajas',
        columnas: columnasCon(op, COLUMNAS_ALTAS),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta }),
    })
}

/*
|--------------------------------------------------------------------------
| Egresos por categoría
|--------------------------------------------------------------------------
*/

export const COLUMNAS_EGRESOS = definirColumnas([
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
    { clave: 'categoria_nombre', titulo: 'Nombre', tipo: 'texto' },
    { clave: 'cuenta_codigo', titulo: 'Cuenta', tipo: 'texto' },
    { clave: 'egresos', titulo: 'Egresos', tipo: 'entero' },
    { clave: 'monto', titulo: 'Monto', tipo: 'dinero' },
])

/** Egresos vigentes (sin anulación) por mes contable y categoría. */
export async function egresosPorCategoria(
    filtros: { desde?: string; hasta?: string; categoria?: ClaveCategoriaEgreso; metodo?: string },
    alcance?: Alcance,
    op: EmpresasReporte = UNA_EMPRESA,
): Promise<Reporte> {
    const { desde, hasta } = rangoPorDefecto(filtros)
    const periodo = `to_char(e.fecha, 'YYYY-MM')`
    const consulta = db
        .from('ledger.egresos as e')
        .join('ledger.egresos_categorias as ec', 'ec.id', 'e.categoria_id')
        .join('ledger.cuentas as cu', 'cu.id', 'ec.cuenta_id')
        .whereNotExists((q) => q.from('ledger.egresos_anulaciones as an').whereRaw('an.egreso_id = e.id'))
        .whereRaw(`e.fecha between date_trunc('month', ?::date) and ?::date`, [desde, hasta])
        .if(filtros.categoria, (q) => q.where('ec.clave', filtros.categoria!))
        .if(filtros.metodo, (q) => q.where('e.metodo', filtros.metodo!))
        .groupByRaw(`${periodo}, ec.clave, ec.nombre, cu.codigo`)
        .orderByRaw(`${periodo} asc, cu.codigo asc`)
        .select(
            db.raw(`${periodo} as periodo`),
            'ec.clave as categoria',
            'ec.nombre as categoria_nombre',
            'cu.codigo as cuenta_codigo',
            db.raw('count(*)::int as egresos'),
            db.raw('sum(e.monto)::text as monto'),
        )
    filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('e.caja_id', ids) })
    porEmpresa(consulta, 'e.empresa_id', op)
    const filas = ((await consulta) as Fila[]).map((f) => ({ ...f, monto: dinero(f.monto) }))
    return armarReporte({
        reporte: 'egresos',
        titulo: 'Egresos por categoría',
        columnas: columnasCon(op, COLUMNAS_EGRESOS),
        filas,
        filtros: filtrosCon(op, { ...filtros, desde, hasta }),
    })
}
