import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/** Reportes de A3 (`GET /reportes/<clave>`), todos con `reportes.ver`. */
export const CLAVES_REPORTE = [
    'cartera-vencida',
    'facturado-vs-cobrado',
    'ingresos',
    'cobranza-diaria',
    'cierres-caja',
    'iva',
    'promesas',
    'altas-bajas',
    'egresos',
] as const

export type ClaveReporte = typeof CLAVES_REPORTE[number]

type OperacionReporte<C extends ClaveReporte> = paths[`/api/v1/reportes/${C}`]['get']

export type RespuestaReporte<C extends ClaveReporte> = OperacionReporte<C>['responses'][200]['content']['application/json']
export type QueryReporte<C extends ClaveReporte> = NonNullable<OperacionReporte<C>['parameters']['query']>
export type ReporteCualquiera = RespuestaReporte<ClaveReporte>
export type ColumnaReporte = Schema<'ColumnaReporte'>
export type FormatoDescarga = 'csv' | 'xlsx'

export type MetodoPagoReporte = NonNullable<QueryReporte<'ingresos'>['metodo']>
export type MetodoEgresoReporte = NonNullable<QueryReporte<'egresos'>['metodo']>
export type CategoriaEgresoReporte = NonNullable<QueryReporte<'egresos'>['categoria']>
export type CanalPromesaReporte = NonNullable<QueryReporte<'promesas'>['canal']>
export type TipoFacturaReporte = NonNullable<QueryReporte<'facturado-vs-cobrado'>['tipo']>
export type AgruparCartera = NonNullable<QueryReporte<'cartera-vencida'>['agrupar']>
export type AgruparIngresos = NonNullable<QueryReporte<'ingresos'>['agrupar']>
export type OrigenReporte = NonNullable<QueryReporte<'ingresos'>['origen']>

/** Estado de los filtros de la pantalla; cada reporte toma solo los que acepta. */
export interface FiltrosReporte {
    desde?: string
    hasta?: string
    corte?: string
    cliente_id?: number
    zona_id?: number
    router_id?: number
    plan_id?: number
    caja_id?: number
    metodo_pago?: MetodoPagoReporte
    metodo_egreso?: MetodoEgresoReporte
    categoria?: CategoriaEgresoReporte
    canal?: CanalPromesaReporte
    tipo?: TipoFacturaReporte
    agrupar_cartera?: AgruparCartera
    agrupar_ingresos?: AgruparIngresos
    origen?: OrigenReporte
}

export type FiltroReporte = 'rango' | 'corte' | 'cliente' | 'zona' | 'router' | 'plan' | 'caja' | 'metodo_pago' | 'metodo_egreso' | 'categoria' | 'canal' | 'tipo' | 'agrupar_cartera' | 'agrupar_ingresos' | 'origen'

export interface PresentacionReporte {
    titulo: string
    descripcion: string
    icono: string
    filtros: readonly FiltroReporte[]
    /** Qué pasa sin fechas: lo dice la API en cada reporte. */
    rangoPorDefecto?: string
    /** Aviso sobre cómo leer el reporte (un cambio de significado de una columna, por ejemplo). */
    nota?: { titulo: string, descripcion: string }
}

const DOCE_MESES = 'Sin fechas: los últimos 12 meses hasta hoy.'
const MES_EN_CURSO = 'Sin fechas: del día 1 del mes hasta hoy.'

export const REPORTES: Record<ClaveReporte, PresentacionReporte> = {
    'cartera-vencida': {
        titulo: 'Cartera vencida',
        descripcion: 'Saldo pendiente por antigüedad (0-30, 31-60, 61-90 y más de 90 días), por cliente, zona, router o plan.',
        icono: 'i-lucide-alarm-clock',
        filtros: ['corte', 'agrupar_cartera', 'cliente', 'zona', 'router', 'plan'],
    },
    'facturado-vs-cobrado': {
        titulo: 'Facturado vs cobrado',
        descripcion: 'Por mes: lo facturado, lo cobrado de esas facturas, lo acreditado con notas de crédito, lo pendiente y el % de cobranza.',
        icono: 'i-lucide-scale',
        filtros: ['rango', 'origen', 'tipo', 'cliente', 'zona', 'router', 'plan'],
        rangoPorDefecto: DOCE_MESES,
        nota: {
            titulo: '«Cobrado» ya no incluye las notas de crédito',
            descripcion: 'Lo acreditado con notas de crédito va en su propia columna: Pendiente = Facturado − Cobrado − Notas de crédito. Las facturas importadas cuentan en el mes de su periodo de origen.',
        },
    },
    'ingresos': {
        titulo: 'Ingresos',
        descripcion: 'Pagos recibidos por periodo y método, con comisión y neto.',
        icono: 'i-lucide-banknote',
        filtros: ['rango', 'origen', 'agrupar_ingresos', 'metodo_pago', 'cliente', 'zona'],
        rangoPorDefecto: DOCE_MESES,
        nota: {
            titulo: 'Incluye los pagos importados',
            descripcion: 'Los pagos históricos de otro sistema cuentan en su mes de origen; «Pagos importados» y «Monto importado» separan esa parte. Usa «Origen» para ver solo una.',
        },
    },
    'cobranza-diaria': {
        titulo: 'Cobranza diaria',
        descripcion: 'Cobros de cada día por método y caja, con los anulados.',
        icono: 'i-lucide-calendar-days',
        filtros: ['rango', 'metodo_pago', 'caja'],
        rangoPorDefecto: MES_EN_CURSO,
    },
    'cierres-caja': {
        titulo: 'Cierres de caja',
        descripcion: 'Turnos cerrados: fondo, cobrado, egresos, esperado, contado y diferencia.',
        icono: 'i-lucide-wallet',
        filtros: ['rango', 'caja'],
        rangoPorDefecto: MES_EN_CURSO,
    },
    'iva': {
        titulo: 'IVA',
        descripcion: 'Base e IVA facturado, anulado y acreditado con notas de crédito por mes, contra el saldo de la cuenta de IVA del libro.',
        icono: 'i-lucide-percent',
        filtros: ['rango'],
        rangoPorDefecto: DOCE_MESES,
        nota: {
            titulo: 'IVA débito neto con notas de crédito',
            descripcion: 'IVA débito neto = IVA facturado − IVA anulado − IVA acreditado (en el mes de cada nota). Debe coincidir con el saldo del mes en 2.1.02.',
        },
    },
    'promesas': {
        titulo: 'Promesas de pago',
        descripcion: 'Creadas, rechazadas, cumplidas e incumplidas por mes y canal, con la tasa de cumplimiento.',
        icono: 'i-lucide-calendar-clock',
        filtros: ['rango', 'canal', 'cliente', 'zona', 'router', 'plan'],
        rangoPorDefecto: DOCE_MESES,
    },
    'altas-bajas': {
        titulo: 'Altas y bajas',
        descripcion: 'Servicios instalados y retirados por mes, con suspensiones, limitaciones y reactivaciones.',
        icono: 'i-lucide-arrow-up-down',
        filtros: ['rango', 'zona', 'router', 'plan'],
        rangoPorDefecto: DOCE_MESES,
    },
    'egresos': {
        titulo: 'Egresos',
        descripcion: 'Gastos por mes y categoría, con su cuenta contable.',
        icono: 'i-lucide-receipt',
        filtros: ['rango', 'categoria', 'metodo_egreso'],
        rangoPorDefecto: DOCE_MESES,
    },
}

export function esClaveReporte(valor: unknown): valor is ClaveReporte {
    return typeof valor === 'string' && (CLAVES_REPORTE as readonly string[]).includes(valor)
}

export const AGRUPAR_CARTERA: Record<AgruparCartera, string> = {
    cliente: 'Por cliente',
    zona: 'Por zona',
    router: 'Por router',
    plan: 'Por plan',
}

/** Título de la columna `grupo` de la cartera según cómo se agrupó. */
export const TITULOS_GRUPO: Record<AgruparCartera, string> = {
    cliente: 'Cliente',
    zona: 'Zona',
    router: 'Router',
    plan: 'Plan',
}

export const AGRUPAR_INGRESOS: Record<AgruparIngresos, string> = {
    mes: 'Por mes',
    dia: 'Por día',
}

export const ORIGENES_REPORTE: Record<OrigenReporte, string> = {
    sistema: 'Registrado en ArgosIsp',
    importado: 'Importado (histórico)',
}

export const TIPOS_FACTURA_REPORTE: Record<TipoFacturaReporte, string> = {
    servicio: 'Solo servicio',
    mora: 'Solo recargos por mora',
}

/**
 * Consulta de cada reporte con solo los filtros que acepta (lo que no aplica queda fuera).
 * `undefined` no viaja en la URL.
 */
export const CONSULTAS_REPORTE: { [C in ClaveReporte]: (f: FiltrosReporte) => QueryReporte<C> } = {
    'cartera-vencida': f => ({ corte: f.corte, agrupar: f.agrupar_cartera, cliente_id: f.cliente_id, zona_id: f.zona_id, router_id: f.router_id, plan_id: f.plan_id }),
    'facturado-vs-cobrado': f => ({ desde: f.desde, hasta: f.hasta, origen: f.origen, tipo: f.tipo, cliente_id: f.cliente_id, zona_id: f.zona_id, router_id: f.router_id, plan_id: f.plan_id }),
    'ingresos': f => ({ desde: f.desde, hasta: f.hasta, origen: f.origen, agrupar: f.agrupar_ingresos, metodo: f.metodo_pago, cliente_id: f.cliente_id, zona_id: f.zona_id }),
    'cobranza-diaria': f => ({ desde: f.desde, hasta: f.hasta, metodo: f.metodo_pago, caja_id: f.caja_id }),
    'cierres-caja': f => ({ desde: f.desde, hasta: f.hasta, caja_id: f.caja_id }),
    'iva': f => ({ desde: f.desde, hasta: f.hasta }),
    'promesas': f => ({ desde: f.desde, hasta: f.hasta, canal: f.canal, cliente_id: f.cliente_id, zona_id: f.zona_id, router_id: f.router_id, plan_id: f.plan_id }),
    'altas-bajas': f => ({ desde: f.desde, hasta: f.hasta, zona_id: f.zona_id, router_id: f.router_id, plan_id: f.plan_id }),
    'egresos': f => ({ desde: f.desde, hasta: f.hasta, categoria: f.categoria, metodo: f.metodo_egreso }),
}

/** Fila del reporte como pares clave → valor, para pintar cualquier reporte con sus `columnas`. */
export type FilaReporte = Record<string, unknown>

export function filasReporte(reporte: ReporteCualquiera): FilaReporte[] {
    return reporte.filas.map(fila => Object.fromEntries(Object.entries(fila)))
}

export function totalesApi(reporte: ReporteCualquiera): FilaReporte {
    return Object.fromEntries(Object.entries(reporte.totales))
}

/**
 * Columnas visibles: un `id` con su nombre al lado (`grupo_id` y `grupo`, `caja_id` y `caja`)
 * no se muestra; uno sin nombre (`turno_id`) sí, como `#12`. El CSV y el Excel las traen todas.
 */
export function columnasVisibles(columnas: readonly ColumnaReporte[]): ColumnaReporte[] {
    const claves = new Set(columnas.map(c => c.clave))
    return columnas.filter((c) => {
        if (c.tipo === 'id' && c.clave.endsWith('_id') && claves.has(c.clave.slice(0, -3))) {
            return false
        }
        // `categoria` (clave interna) cuando viene `categoria_nombre`.
        return !(c.tipo === 'texto' && claves.has(`${c.clave}_nombre`))
    })
}

function decimal(valor: unknown): Decimal | null {
    if (typeof valor !== 'string' && typeof valor !== 'number') {
        return null
    }
    try {
        const numero = new Decimal(valor)
        return numero.isFinite() ? numero : null
    }
    catch {
        return null
    }
}

/**
 * Totales con `decimal.js` de las columnas de dinero y enteros, sumando las filas recibidas.
 * Los porcentajes no se suman: se toma el total que calculó la API (o nada).
 */
export function totalesReporte(columnas: readonly ColumnaReporte[], filas: readonly FilaReporte[], api: FilaReporte = {}): Record<string, Decimal | number | null> {
    const totales: Record<string, Decimal | number | null> = {}
    for (const columna of columnas) {
        if (columna.tipo === 'dinero' || columna.tipo === 'entero') {
            totales[columna.clave] = filas.reduce((suma, fila) => suma.plus(decimal(fila[columna.clave]) ?? 0), new Decimal(0))
        }
        else if (columna.tipo === 'porcentaje') {
            const valor = api[columna.clave]
            totales[columna.clave] = typeof valor === 'number' ? valor : null
        }
        else {
            totales[columna.clave] = null
        }
    }
    return totales
}

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function etiquetaDe(mapa: Record<string, string>, valor: string): string | undefined {
    return Object.entries(mapa).find(([clave]) => clave === valor)?.[1]
}

function etiquetaTexto(clave: string, valor: string): string {
    const conocida = clave === 'metodo'
        ? etiquetaDe(ETIQUETAS_METODO, valor)
        : clave === 'canal' ? etiquetaDe(CANALES_PROMESA, valor) : undefined
    if (conocida) {
        return conocida
    }
    if (PERIODO.test(valor)) {
        return etiquetaPeriodo(valor)
    }
    if (FECHA.test(valor)) {
        return formatearFecha(valor)
    }
    if (INSTANTE.test(valor)) {
        return formatearFechaHora(valor)
    }
    return valor
}

/** Celda formateada según el tipo de la columna: quetzales, miles, fechas de Guatemala, %. */
export function celdaReporte(columna: ColumnaReporte, valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') {
        return '—'
    }
    const numero = valor instanceof Decimal ? valor : decimal(valor)
    switch (columna.tipo) {
        case 'dinero':
            return numero ? formatearQuetzales(numero) : '—'
        case 'entero':
            return numero ? numero.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—'
        case 'porcentaje':
            return numero ? `${numero.toDecimalPlaces(2).toString()} %` : '—'
        case 'id':
            return `#${String(valor)}`
        case 'fecha':
            return typeof valor === 'string' ? etiquetaTexto(columna.clave, valor) : String(valor)
        default:
            return typeof valor === 'string' ? etiquetaTexto(columna.clave, valor) : String(valor)
    }
}

/** Una diferencia de caja distinta de cero o un neto negativo se resaltan. */
export function esNegativo(columna: ColumnaReporte, valor: unknown): boolean {
    if (columna.tipo !== 'dinero' && columna.tipo !== 'entero') {
        return false
    }
    const numero = valor instanceof Decimal ? valor : decimal(valor)
    return numero !== null && numero.isNegative() && !numero.isZero()
}

/** `cartera-vencida-2026-10-16.xlsx`. */
export function nombreDescarga(clave: ClaveReporte, formato: FormatoDescarga, hoy: string): string {
    return `${clave}-${hoy}.${formato}`
}
