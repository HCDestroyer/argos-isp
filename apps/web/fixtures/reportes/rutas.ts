import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { conPermiso, datosInvalidos } from '../comun'
import { resumenDashboard } from './datos'
import { altasBajas, carteraVencida, cierresCaja, cobranzaDiaria, egresos, facturadoCobrado, ingresos, iva, promesas } from './reportes'

type Columna = Schema<'ColumnaReporte'>
type Valor = string | number | null

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const HOY = '2026-10-16'

/** Totales como `armarReporte` de la API: dinero con decimal.js (string), enteros sumados, el resto null. */
function totales(columnas: Columna[], filas: readonly Record<string, Valor>[]): Record<string, Valor> {
    return Object.fromEntries(columnas.map((c): [string, Valor] => {
        if (c.tipo === 'dinero') {
            return [c.clave, filas.reduce((s, f) => s.plus(f[c.clave] ?? 0), new Decimal(0)).toFixed(2)]
        }
        if (c.tipo === 'entero') {
            return [c.clave, filas.reduce((s, f) => s + Number(f[c.clave] ?? 0), 0)]
        }
        return [c.clave, null]
    }))
}

function porcentaje(parte: Decimal.Value, total: Decimal.Value): number {
    const divisor = new Decimal(total)
    return divisor.isZero() ? 0 : new Decimal(parte).times(100).div(divisor).toDecimalPlaces(2).toNumber()
}

/** CSV como lo exporta la API: títulos, filas y la fila "Total". */
function csv(columnas: Columna[], filas: readonly Record<string, Valor>[], suma: Record<string, Valor>): Uint8Array {
    const celda = (v: Valor) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const lineas = [
        columnas.map(c => celda(c.titulo)).join(','),
        ...filas.map(f => columnas.map(c => celda(f[c.clave] ?? null)).join(',')),
        columnas.map((c, i) => (i === 0 ? 'Total' : celda(suma[c.clave] ?? null))).join(','),
    ]
    return new TextEncoder().encode(`${lineas.join('\n')}\n`)
}

interface Definicion<F> {
    reporte: string
    titulo: string
    columnas: Columna[]
    filas: F[]
    /** Fecha o periodo de la fila para el filtro de fechas. */
    fecha?: (fila: F) => string
    filtrar?: (fila: F, query: URLSearchParams) => boolean
    extra?: (filas: F[]) => Record<string, Valor>
    porDefecto?: Record<string, string>
    /** `origen=sistema|importado`: la fila con solo esa parte (o `null` si queda vacía). */
    porOrigen?: (fila: F, origen: Origen) => F | null
}

type Origen = 'sistema' | 'importado'

function leerOrigen(query: URLSearchParams): Origen | null {
    const valor = query.get('origen')
    return valor === 'sistema' || valor === 'importado' ? valor : null
}

const dec = (valor: Decimal.Value) => new Decimal(valor)

function ruta<F extends Record<string, Valor>>(definicion: Definicion<F>) {
    return conPermiso('reportes.ver', (solicitud: SolicitudFixture): RespuestaFixture => {
        const { query } = solicitud
        const desde = query.get('desde')
        const hasta = query.get('hasta')
        const errores = [['desde', desde], ['hasta', hasta], ['corte', query.get('corte')]]
            .filter(([, v]) => v && !FECHA.test(v))
            .map(([field]) => ({ field: field ?? '', message: 'Fecha inválida (AAAA-MM-DD)', rule: 'regex' }))
        const origenPedido = query.get('origen')
        if (origenPedido && !leerOrigen(query)) {
            errores.push({ field: 'origen', message: 'El origen debe ser sistema o importado', rule: 'enum' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const origen = leerOrigen(query)
        const porOrigen = definicion.porOrigen
        const base = origen && porOrigen
            ? definicion.filas.map(fila => porOrigen(fila, origen)).filter((fila): fila is F => fila !== null)
            : definicion.filas
        const filas = base.filter((fila) => {
            const fecha = definicion.fecha?.(fila)
            if (fecha && desde && fecha < desde.slice(0, fecha.length)) {
                return false
            }
            if (fecha && hasta && fecha > hasta.slice(0, fecha.length)) {
                return false
            }
            return definicion.filtrar ? definicion.filtrar(fila, query) : true
        })
        const suma = { ...totales(definicion.columnas, filas), ...definicion.extra?.(filas) }
        const formato = query.get('formato')
        if (formato === 'csv') {
            return { status: 200, cuerpo: csv(definicion.columnas, filas, suma), contentType: 'text/csv; charset=utf-8' }
        }
        if (formato === 'xlsx') {
            // Un .xlsx es un ZIP: basta la firma para probar la descarga.
            return { status: 200, cuerpo: new Uint8Array([0x50, 0x4B, 0x03, 0x04]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        }
        const filtros: Record<string, unknown> = { ...definicion.porDefecto }
        for (const [clave, valor] of query.entries()) {
            filtros[clave] = valor
        }
        return {
            status: 200,
            cuerpo: { reporte: definicion.reporte, titulo: definicion.titulo, filtros, columnas: definicion.columnas, filas, totales: suma, generado_en: `${HOY}T17:45:00.000Z` },
        }
    })
}

const ULTIMOS_12 = { desde: '2025-11-01', hasta: HOY }
const MES = { desde: '2026-10-01', hasta: HOY }

function igual(query: URLSearchParams, clave: string, valor: Valor): boolean {
    const pedido = query.get(clave)
    return pedido === null || pedido === '' || pedido === String(valor)
}

export const rutasReportes: RutasFixture = {
    'GET /api/v1/dashboard/resumen': conPermiso('reportes.ver', () => ({ status: 200, cuerpo: structuredClone(resumenDashboard) })),

    'GET /api/v1/reportes/cartera-vencida': ruta({
        reporte: 'cartera-vencida',
        titulo: 'Cartera vencida por antigüedad',
        ...carteraVencida,
        filtrar: (f, q) => igual(q, 'cliente_id', f.grupo_id),
        porDefecto: { corte: HOY, agrupar: 'cliente' },
    }),
    'GET /api/v1/reportes/facturado-vs-cobrado': ruta({
        reporte: 'facturado-vs-cobrado',
        titulo: 'Facturado vs cobrado',
        ...facturadoCobrado,
        fecha: f => f.periodo,
        // Como A3: `origen` filtra por factura (`clave_externa`); aquí, la parte importada de cada mes.
        porOrigen: (f, origen) => {
            const facturado = origen === 'importado' ? dec(f.facturado_importado ?? 0) : dec(f.facturado).minus(f.facturado_importado ?? 0)
            const cobrado = origen === 'importado' ? dec(f.cobrado_importado ?? 0) : dec(f.cobrado).minus(f.cobrado_importado ?? 0)
            if (facturado.isZero()) {
                return null
            }
            const acreditado = origen === 'importado' ? dec(0) : dec(f.acreditado ?? 0)
            return {
                ...f,
                facturado: facturado.toFixed(2),
                cobrado: cobrado.toFixed(2),
                acreditado: acreditado.toFixed(2),
                pendiente: facturado.minus(cobrado).minus(acreditado).toFixed(2),
                cobranza_pct: porcentaje(cobrado, facturado),
                facturado_importado: origen === 'importado' ? facturado.toFixed(2) : '0.00',
                cobrado_importado: origen === 'importado' ? cobrado.toFixed(2) : '0.00',
            }
        },
        extra: filas => ({ cobranza_pct: porcentaje(filas.reduce((s, f) => s.plus(f.cobrado), new Decimal(0)), filas.reduce((s, f) => s.plus(f.facturado), new Decimal(0))) }),
        porDefecto: ULTIMOS_12,
    }),
    'GET /api/v1/reportes/ingresos': ruta({
        reporte: 'ingresos',
        titulo: 'Ingresos por periodo y método',
        ...ingresos,
        fecha: f => f.periodo,
        porOrigen: (f, origen) => {
            const pagos = origen === 'importado' ? (f.pagos_importados ?? 0) : f.pagos - (f.pagos_importados ?? 0)
            if (pagos === 0) {
                return null
            }
            const monto = origen === 'importado' ? dec(f.monto_importado ?? 0) : dec(f.monto).minus(f.monto_importado ?? 0)
            // Los pagos importados no tienen comisión.
            const comision = origen === 'importado' ? dec(0) : dec(f.comision)
            return {
                ...f,
                pagos,
                monto: monto.toFixed(2),
                comision: comision.toFixed(2),
                neto: monto.minus(comision).toFixed(2),
                pagos_importados: origen === 'importado' ? pagos : 0,
                monto_importado: origen === 'importado' ? monto.toFixed(2) : '0.00',
            }
        },
        filtrar: (f, q) => igual(q, 'metodo', f.metodo),
        porDefecto: { ...ULTIMOS_12, agrupar: 'mes' },
    }),
    'GET /api/v1/reportes/cobranza-diaria': ruta({
        reporte: 'cobranza-diaria',
        titulo: 'Cobranza diaria',
        ...cobranzaDiaria,
        fecha: f => f.fecha,
        filtrar: (f, q) => igual(q, 'metodo', f.metodo) && igual(q, 'caja_id', f.caja_id),
        porDefecto: MES,
    }),
    'GET /api/v1/reportes/cierres-caja': ruta({
        reporte: 'cierres-caja',
        titulo: 'Cierres de caja',
        ...cierresCaja,
        fecha: f => f.cerrado_en.slice(0, 10),
        filtrar: (f, q) => igual(q, 'caja_id', f.caja_id),
        porDefecto: MES,
    }),
    'GET /api/v1/reportes/iva': ruta({ reporte: 'iva', titulo: 'IVA del periodo', ...iva, fecha: f => f.periodo, porDefecto: ULTIMOS_12 }),
    'GET /api/v1/reportes/promesas': ruta({
        reporte: 'promesas',
        titulo: 'Promesas de pago',
        ...promesas,
        fecha: f => f.periodo,
        filtrar: (f, q) => igual(q, 'canal', f.canal),
        extra: (filas) => {
            const cumplidas = filas.reduce((s, f) => s + f.cumplidas, 0)
            return { tasa_cumplimiento: porcentaje(cumplidas, cumplidas + filas.reduce((s, f) => s + f.incumplidas, 0)) }
        },
        porDefecto: ULTIMOS_12,
    }),
    'GET /api/v1/reportes/altas-bajas': ruta({ reporte: 'altas-bajas', titulo: 'Altas y bajas', ...altasBajas, fecha: f => f.periodo, porDefecto: ULTIMOS_12 }),
    'GET /api/v1/reportes/egresos': ruta({
        reporte: 'egresos',
        titulo: 'Egresos por categoría',
        ...egresos,
        fecha: f => f.periodo,
        filtrar: (f, q) => igual(q, 'categoria', f.categoria),
        porDefecto: ULTIMOS_12,
    }),
}
