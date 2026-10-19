import type { Schema, paths } from '@argosisp/contracts'

export type PremioLealtad = Schema<'PremioLealtad'>
export type FiltrosPremiosLealtad = Omit<NonNullable<paths['/api/v1/lealtad/premios']['get']['parameters']['query']>, 'cursor'>

/**
 * Catálogo de premios de lealtad (A3, fase 2; `lealtad.ver`). El sorteo lo lee para elegir el
 * descuento o mes gratis de un premio de tipo `servicio`.
 */
export function usePremiosLealtad() {
    const api = useApi()

    function listar(filtros: FiltrosPremiosLealtad = {}, cursor?: string): Promise<Resultado<Pagina<PremioLealtad>>> {
        const query: FiltrosPremiosLealtad & { cursor?: string } = { limit: 100, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/lealtad/premios', { params: { query } }))
    }

    return { listar }
}
