import {
    Dinero,
    definirEsquema,
    entero,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { esquemaReporte } from '#billing/reportes/definicion'
import {
    COLUMNAS_ALTAS,
    COLUMNAS_CARTERA,
    COLUMNAS_CIERRES,
    COLUMNAS_COBRANZA,
    COLUMNAS_EGRESOS,
    COLUMNAS_FACTURADO,
    COLUMNAS_INGRESOS,
    COLUMNAS_IVA,
    COLUMNAS_PROMESAS,
    COLUMNAS_SIN_COSTO,
} from '#billing/reportes/reportes'

/** Schemas de los reportes (filas tipadas por sus columnas) y del dashboard. */

export const ReporteCarteraVencida = esquemaReporte('ReporteCarteraVencida', COLUMNAS_CARTERA)
export const ReporteIngresos = esquemaReporte('ReporteIngresos', COLUMNAS_INGRESOS)
export const ReporteFacturadoCobrado = esquemaReporte('ReporteFacturadoCobrado', COLUMNAS_FACTURADO)
export const ReporteCobranzaDiaria = esquemaReporte('ReporteCobranzaDiaria', COLUMNAS_COBRANZA)
export const ReporteCierresCaja = esquemaReporte('ReporteCierresCaja', COLUMNAS_CIERRES)
export const ReporteIva = esquemaReporte('ReporteIva', COLUMNAS_IVA)
export const ReportePromesas = esquemaReporte('ReportePromesas', COLUMNAS_PROMESAS)
export const ReporteAltasBajas = esquemaReporte('ReporteAltasBajas', COLUMNAS_ALTAS)
export const ReporteEgresos = esquemaReporte('ReporteEgresos', COLUMNAS_EGRESOS)
export const ReporteFacturasSinCosto = esquemaReporte('ReporteFacturasSinCosto', COLUMNAS_SIN_COSTO)

const porcentaje = { type: 'number', description: 'Porcentaje 0–100 con 2 decimales' }

export const ResumenDashboard = definirEsquema(
    'ResumenDashboard',
    objeto({
        servicios: objeto({ activos: entero, limitados: entero, suspendidos: entero, retirados: entero }),
        clientes: {
            ...objeto({ activos: entero, limitados: entero, cortados: entero }),
            description: 'Clientes con al menos un servicio en ese estado',
        },
        mes: objeto({ periodo: texto, facturado: Dinero, cobrado: Dinero, cobranza_pct: porcentaje }),
        cartera_vencida: objeto({
            monto: Dinero,
            facturas: entero,
            clientes: entero,
            pendiente_total: Dinero,
        }),
        hoy: objeto({ fecha: { type: 'string', format: 'date' }, cobrado: Dinero, pagos: entero }),
        promesas_activas: objeto({ cantidad: entero, monto: Dinero }),
        series: {
            ...lista(
                objeto({
                    periodo: texto,
                    facturado: Dinero,
                    cobrado: Dinero,
                    facturas: entero,
                    pagos: entero,
                }),
            ),
            description: 'Últimos 12 meses (YYYY-MM), el actual al final',
        },
        actualizado_en: {
            ...objeto({
                resumen_mensual: nulable(instante),
                resumen_cobros_diarios: nulable(instante),
                resumen_servicios: nulable(instante),
                resumen_cartera: nulable(instante),
                resumen_promesas: nulable(instante),
            }),
            description: 'Último refresco de cada vista (por evento)',
        },
    }),
)
