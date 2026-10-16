import type { Schema } from '@argosisp/contracts'

/**
 * Reportes de A3 como los responde la API (`columnas`, `filas` tipadas por reporte). Las
 * columnas y sus títulos son los de `apps/api/app/billing/reportes`; `totales`, `filtros` y
 * `generado_en` los arma la ruta del fixture con los filtros recibidos.
 */
type Columna = Schema<'ColumnaReporte'>

function c(clave: string, titulo: string, tipo: Columna['tipo']): Columna {
    return { clave, titulo, tipo }
}

export const carteraVencida: { columnas: Columna[], filas: Schema<'ReporteCarteraVencida'>['filas'] } = {
    columnas: [
        c('grupo_id', 'Id', 'id'), c('grupo', 'Grupo', 'texto'), c('facturas', 'Facturas', 'entero'),
        c('por_vencer', 'Por vencer', 'dinero'), c('dias_0_30', '0-30 días', 'dinero'), c('dias_31_60', '31-60 días', 'dinero'),
        c('dias_61_90', '61-90 días', 'dinero'), c('dias_mas_90', 'Más de 90 días', 'dinero'), c('vencido', 'Total vencido', 'dinero'),
        c('total', 'Total pendiente', 'dinero'),
    ],
    filas: [
        { grupo_id: 2, grupo: 'Carlos Enrique Pérez', facturas: 3, por_vencer: '175.00', dias_0_30: '175.00', dias_31_60: '183.33', dias_61_90: '0.00', dias_mas_90: '0.00', vencido: '358.33', total: '533.33' },
        { grupo_id: 3, grupo: 'Distribuidora El Quetzal, S.A.', facturas: 4, por_vencer: '450.00', dias_0_30: '450.00', dias_31_60: '450.00', dias_61_90: '0.00', dias_mas_90: '0.00', vencido: '900.00', total: '1350.00' },
        { grupo_id: 5, grupo: 'Jorge Alberto Castillo', facturas: 2, por_vencer: '0.00', dias_0_30: '268.33', dias_31_60: '0.00', dias_61_90: '0.00', dias_mas_90: '125.50', vencido: '393.83', total: '393.83' },
    ],
}

export const facturadoCobrado: { columnas: Columna[], filas: Schema<'ReporteFacturadoCobrado'>['filas'] } = {
    columnas: [
        c('periodo', 'Periodo', 'texto'), c('facturas', 'Facturas', 'entero'), c('facturado', 'Facturado', 'dinero'),
        c('cobrado', 'Cobrado', 'dinero'), c('pendiente', 'Pendiente', 'dinero'), c('cobranza_pct', '% cobrado', 'porcentaje'),
    ],
    filas: [
        { periodo: '2026-08', facturas: 412, facturado: '93880.00', cobrado: '90204.10', pendiente: '3675.90', cobranza_pct: 96.08 },
        { periodo: '2026-09', facturas: 431, facturado: '96120.00', cobrado: '91980.65', pendiente: '4139.35', cobranza_pct: 95.69 },
        { periodo: '2026-10', facturas: 438, facturado: '98450.00', cobrado: '61230.75', pendiente: '37219.25', cobranza_pct: 62.19 },
    ],
}

export const ingresos: { columnas: Columna[], filas: Schema<'ReporteIngresos'>['filas'] } = {
    columnas: [
        c('periodo', 'Periodo', 'texto'), c('metodo', 'Método', 'texto'), c('pagos', 'Pagos', 'entero'),
        c('monto', 'Monto', 'dinero'), c('comision', 'Comisión', 'dinero'), c('neto', 'Neto', 'dinero'),
    ],
    filas: [
        { periodo: '2026-09', metodo: 'caja', pagos: 301, monto: '58410.25', comision: '0.00', neto: '58410.25' },
        { periodo: '2026-09', metodo: 'pasarela', pagos: 88, monto: '19870.40', comision: '596.11', neto: '19274.29' },
        { periodo: '2026-10', metodo: 'caja', pagos: 205, monto: '40110.00', comision: '0.00', neto: '40110.00' },
        { periodo: '2026-10', metodo: 'transferencia', pagos: 61, monto: '13320.75', comision: '0.00', neto: '13320.75' },
    ],
}

export const cobranzaDiaria: { columnas: Columna[], filas: Schema<'ReporteCobranzaDiaria'>['filas'] } = {
    columnas: [
        c('fecha', 'Fecha', 'fecha'), c('metodo', 'Método', 'texto'), c('caja_id', 'Caja', 'id'), c('caja', 'Nombre de caja', 'texto'),
        c('pagos', 'Pagos', 'entero'), c('monto', 'Cobrado', 'dinero'), c('anulados', 'Anulados', 'entero'), c('monto_anulado', 'Monto anulado', 'dinero'),
    ],
    filas: [
        { fecha: '2026-10-15', metodo: 'caja', caja_id: 1, caja: 'Caja principal', pagos: 22, monto: '4410.00', anulados: 1, monto_anulado: '175.00' },
        { fecha: '2026-10-16', metodo: 'caja', caja_id: 1, caja: 'Caja principal', pagos: 15, monto: '3105.00', anulados: 0, monto_anulado: '0.00' },
        { fecha: '2026-10-16', metodo: 'transferencia', caja_id: null, caja: null, pagos: 4, monto: '1275.00', anulados: 0, monto_anulado: '0.00' },
    ],
}

export const cierresCaja: { columnas: Columna[], filas: Schema<'ReporteCierresCaja'>['filas'] } = {
    columnas: [
        c('turno_id', 'Turno', 'id'), c('caja_id', 'Caja', 'id'), c('caja', 'Nombre de caja', 'texto'), c('abierto_en', 'Abierto', 'texto'),
        c('cerrado_en', 'Cerrado', 'texto'), c('abierto_por', 'Abrió', 'texto'), c('cerrado_por', 'Cerró', 'texto'),
        c('fondo_inicial', 'Fondo inicial', 'dinero'), c('cobrado', 'Cobrado', 'dinero'), c('egresos', 'Egresos', 'dinero'),
        c('esperado', 'Esperado', 'dinero'), c('contado', 'Contado', 'dinero'), c('diferencia', 'Diferencia', 'dinero'), c('motivo', 'Motivo', 'texto'),
    ],
    filas: [
        { turno_id: 7, caja_id: 1, caja: 'Caja principal', abierto_en: '2026-10-15T14:00:00.000Z', cerrado_en: '2026-10-16T00:05:00.000Z', abierto_por: 'Carla Cajera', cerrado_por: 'Carla Cajera', fondo_inicial: '500.00', cobrado: '4235.00', egresos: '150.00', esperado: '4585.00', contado: '4565.00', diferencia: '-20.00', motivo: 'Faltante de un billete de Q 20' },
        { turno_id: 8, caja_id: 1, caja: 'Caja principal', abierto_en: '2026-10-16T14:00:00.000Z', cerrado_en: '2026-10-16T23:55:00.000Z', abierto_por: 'Carla Cajera', cerrado_por: 'Ana Administradora', fondo_inicial: '500.00', cobrado: '3105.00', egresos: '0.00', esperado: '3605.00', contado: '3605.00', diferencia: '0.00', motivo: null },
    ],
}

export const iva: { columnas: Columna[], filas: Schema<'ReporteIva'>['filas'] } = {
    columnas: [
        c('periodo', 'Periodo', 'texto'), c('facturas', 'Facturas emitidas', 'entero'), c('base', 'Base gravable', 'dinero'),
        c('iva_facturado', 'IVA facturado', 'dinero'), c('facturas_anuladas', 'Facturas anuladas', 'entero'), c('base_anulada', 'Base anulada', 'dinero'),
        c('iva_anulado', 'IVA anulado', 'dinero'), c('iva_neto', 'IVA débito neto', 'dinero'), c('iva_libro', 'Saldo del mes en 2.1.02', 'dinero'),
    ],
    filas: [
        { periodo: '2026-09', facturas: 431, base: '85821.43', iva_facturado: '10298.57', facturas_anuladas: 2, base_anulada: '312.50', iva_anulado: '37.50', iva_neto: '10261.07', iva_libro: '10261.07' },
        { periodo: '2026-10', facturas: 438, base: '87901.79', iva_facturado: '10548.21', facturas_anuladas: 0, base_anulada: '0.00', iva_anulado: '0.00', iva_neto: '10548.21', iva_libro: '10548.21' },
    ],
}

export const promesas: { columnas: Columna[], filas: Schema<'ReportePromesas'>['filas'] } = {
    columnas: [
        c('periodo', 'Periodo', 'texto'), c('canal', 'Canal', 'texto'), c('creadas', 'Creadas', 'entero'), c('rechazadas', 'Rechazadas', 'entero'),
        c('pendientes', 'Pendientes de aprobación', 'entero'), c('activas', 'Activas', 'entero'), c('cumplidas', 'Cumplidas', 'entero'),
        c('incumplidas', 'Incumplidas', 'entero'), c('canceladas', 'Canceladas', 'entero'), c('monto_prometido', 'Monto prometido', 'dinero'),
        c('tasa_cumplimiento', '% cumplimiento', 'porcentaje'),
    ],
    filas: [
        { periodo: '2026-10', canal: 'portal', creadas: 12, rechazadas: 2, pendientes: 0, activas: 4, cumplidas: 5, incumplidas: 1, canceladas: 0, monto_prometido: '2350.00', tasa_cumplimiento: 83.33 },
        { periodo: '2026-10', canal: 'operador', creadas: 6, rechazadas: 0, pendientes: 1, activas: 3, cumplidas: 2, incumplidas: 0, canceladas: 0, monto_prometido: '1180.00', tasa_cumplimiento: 100 },
    ],
}

export const altasBajas: { columnas: Columna[], filas: Schema<'ReporteAltasBajas'>['filas'] } = {
    columnas: [
        c('periodo', 'Periodo', 'texto'), c('altas', 'Altas', 'entero'), c('bajas', 'Bajas (retiros)', 'entero'), c('suspensiones', 'Suspensiones', 'entero'),
        c('limitaciones', 'Limitaciones', 'entero'), c('reactivaciones', 'Reactivaciones', 'entero'), c('neto', 'Altas − bajas', 'entero'),
    ],
    filas: [
        { periodo: '2026-08', altas: 14, bajas: 3, suspensiones: 21, limitaciones: 9, reactivaciones: 25, neto: 11 },
        { periodo: '2026-09', altas: 9, bajas: 5, suspensiones: 18, limitaciones: 7, reactivaciones: 20, neto: 4 },
        { periodo: '2026-10', altas: 2, bajas: 4, suspensiones: 37, limitaciones: 18, reactivaciones: 6, neto: -2 },
    ],
}

export const egresos: { columnas: Columna[], filas: Schema<'ReporteEgresos'>['filas'] } = {
    columnas: [
        c('periodo', 'Periodo', 'texto'), c('categoria', 'Categoría', 'texto'), c('categoria_nombre', 'Nombre', 'texto'),
        c('cuenta_codigo', 'Cuenta', 'texto'), c('egresos', 'Egresos', 'entero'), c('monto', 'Monto', 'dinero'),
    ],
    filas: [
        { periodo: '2026-10', categoria: 'energia', categoria_nombre: 'Energía eléctrica', cuenta_codigo: '5.1.02', egresos: 2, monto: '1850.40' },
        { periodo: '2026-10', categoria: 'transito', categoria_nombre: 'Tránsito de internet', cuenta_codigo: '5.1.01', egresos: 1, monto: '12500.00' },
    ],
}
