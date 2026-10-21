import type { Schema, paths } from '@argosisp/contracts'

export type Bonificacion = Schema<'Bonificacion'>
export type FiltrosBonificaciones = Omit<NonNullable<paths['/api/v1/bonificaciones']['get']['parameters']['query']>, 'cursor'>

/**
 * Bonificaciones (A3, decisión del PM: nunca una factura de Q0). Solo lectura con `facturas.ver`;
 * nacen del cron (mes gratis, descuento del 100 %, canje) o de un cargo único sin costo.
 */
export function useBonificaciones() {
    const api = useApi()

    function listar(filtros: FiltrosBonificaciones = {}, cursor?: string): Promise<Resultado<Pagina<Bonificacion>>> {
        const query: FiltrosBonificaciones & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bonificaciones', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Bonificacion>> {
        return resolver(api.GET('/api/v1/bonificaciones/{id}', { params: { path: { id } } }))
    }

    return { listar, ver }
}
