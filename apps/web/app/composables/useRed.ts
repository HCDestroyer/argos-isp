import type { Schema, paths } from '@argosisp/contracts'

export type EventoRed = Schema<'EventoRed'>
export type FiltrosEventosRed = Omit<NonNullable<paths['/api/v1/red/eventos']['get']['parameters']['query']>, 'cursor'>

/**
 * Eventos de red (A2, `red.ver`): lectura de `audit.red`, cada CoA, Disconnect o comando a
 * RouterOS con la respuesta del equipo, el más reciente primero.
 */
export function useRed() {
    const api = useApi()

    function eventos(filtros: FiltrosEventosRed = {}, cursor?: string): Promise<Resultado<Pagina<EventoRed>>> {
        const query: FiltrosEventosRed & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/red/eventos', { params: { query } }))
    }

    return { eventos }
}
