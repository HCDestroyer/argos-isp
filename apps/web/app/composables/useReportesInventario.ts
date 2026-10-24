import type { Schema, paths } from '@argosisp/contracts'

export type InventarioValorizado = Schema<'InventarioValorizado'>
export type FiltrosValorizado = NonNullable<paths['/api/v1/reportes/inventario-valorizado']['get']['parameters']['query']>
export type FiltrosPorRecuperar = Omit<NonNullable<paths['/api/v1/reportes/equipos-por-recuperar']['get']['parameters']['query']>, 'cursor'>

/** Reportes del inventario (A3): valorizado a una fecha (con el cuadre contra `1.1.14`) y equipos por recuperar. */
export function useReportesInventario() {
    const api = useApi()

    /** `GET /reportes/inventario-valorizado?fecha=`: existencias y valor reconstruidos del kardex. */
    function valorizado(filtros: FiltrosValorizado): Promise<Resultado<InventarioValorizado>> {
        return resolver(api.GET('/api/v1/reportes/inventario-valorizado', { params: { query: filtros } }))
    }

    /** `GET /reportes/equipos-por-recuperar`: equipos en casa de servicios retirados. */
    function porRecuperar(filtros: FiltrosPorRecuperar = {}, cursor?: string): Promise<Resultado<Pagina<Schema<'EquipoServicio'>>>> {
        const query: FiltrosPorRecuperar & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/reportes/equipos-por-recuperar', { params: { query } }))
    }

    return { valorizado, porRecuperar }
}
