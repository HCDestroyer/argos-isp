import type { Schema } from '@argosisp/contracts'

export type ResumenDashboard = Schema<'ResumenDashboard'>

/**
 * Reportes de A3 (`reportes.ver`): el resumen del dashboard y los reportes con filtros, en JSON
 * o descargados como CSV o Excel.
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

    return { resumenDashboard }
}
