import type { Schema } from '@argosisp/contracts'

export type ResumenDashboard = Schema<'ResumenDashboard'>

type Pedir = { [C in ClaveReporte]: (query: QueryReporte<C>) => Promise<Resultado<RespuestaReporte<C>>> }
type Descargar = { [C in ClaveReporte]: (query: QueryReporte<C>) => Promise<Resultado<Blob>> }

/**
 * Reportes de A3 (`reportes.ver`): el resumen del dashboard y los reportes con filtros, en JSON
 * o descargados como CSV o Excel (`?formato=csv|xlsx`, llegan como `Blob`).
 */
export function useReportes() {
    const api = useApi()

    /**
     * `GET /dashboard/resumen`. Lo arman vistas que el `billing-worker` refresca por evento: tras
     * un cobro puede tardar lo que tarden el relay y el worker.
     */
    function resumenDashboard(): Promise<Resultado<ResumenDashboard>> {
        return resolver(api.GET('/api/v1/dashboard/resumen'))
    }

    const pedir: Pedir = {
        'cartera-vencida': query => resolver(api.GET('/api/v1/reportes/cartera-vencida', { params: { query } })),
        'facturado-vs-cobrado': query => resolver(api.GET('/api/v1/reportes/facturado-vs-cobrado', { params: { query } })),
        'ingresos': query => resolver(api.GET('/api/v1/reportes/ingresos', { params: { query } })),
        'cobranza-diaria': query => resolver(api.GET('/api/v1/reportes/cobranza-diaria', { params: { query } })),
        'cierres-caja': query => resolver(api.GET('/api/v1/reportes/cierres-caja', { params: { query } })),
        'iva': query => resolver(api.GET('/api/v1/reportes/iva', { params: { query } })),
        'promesas': query => resolver(api.GET('/api/v1/reportes/promesas', { params: { query } })),
        'altas-bajas': query => resolver(api.GET('/api/v1/reportes/altas-bajas', { params: { query } })),
        'egresos': query => resolver(api.GET('/api/v1/reportes/egresos', { params: { query } })),
        'bonificaciones': query => resolver(api.GET('/api/v1/reportes/bonificaciones', { params: { query } })),
    }

    const descargas: Descargar = {
        'cartera-vencida': query => resolver(api.GET('/api/v1/reportes/cartera-vencida', { params: { query }, parseAs: 'blob' })),
        'facturado-vs-cobrado': query => resolver(api.GET('/api/v1/reportes/facturado-vs-cobrado', { params: { query }, parseAs: 'blob' })),
        'ingresos': query => resolver(api.GET('/api/v1/reportes/ingresos', { params: { query }, parseAs: 'blob' })),
        'cobranza-diaria': query => resolver(api.GET('/api/v1/reportes/cobranza-diaria', { params: { query }, parseAs: 'blob' })),
        'cierres-caja': query => resolver(api.GET('/api/v1/reportes/cierres-caja', { params: { query }, parseAs: 'blob' })),
        'iva': query => resolver(api.GET('/api/v1/reportes/iva', { params: { query }, parseAs: 'blob' })),
        'promesas': query => resolver(api.GET('/api/v1/reportes/promesas', { params: { query }, parseAs: 'blob' })),
        'altas-bajas': query => resolver(api.GET('/api/v1/reportes/altas-bajas', { params: { query }, parseAs: 'blob' })),
        'egresos': query => resolver(api.GET('/api/v1/reportes/egresos', { params: { query }, parseAs: 'blob' })),
        'bonificaciones': query => resolver(api.GET('/api/v1/reportes/bonificaciones', { params: { query }, parseAs: 'blob' })),
    }

    /** `GET /reportes/:clave` con solo los filtros que ese reporte acepta. */
    function reporte<C extends ClaveReporte>(clave: C, filtros: FiltrosReporte = {}): Promise<Resultado<RespuestaReporte<C>>> {
        return pedir[clave](CONSULTAS_REPORTE[clave](filtros))
    }

    /** El mismo reporte como archivo (`Content-Disposition: attachment`). */
    function descargar<C extends ClaveReporte>(clave: C, filtros: FiltrosReporte, formato: FormatoDescarga): Promise<Resultado<Blob>> {
        return descargas[clave]({ ...CONSULTAS_REPORTE[clave](filtros), formato })
    }

    return { resumenDashboard, reporte, descargar }
}
