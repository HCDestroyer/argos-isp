import type { Schema, paths } from '@argosisp/contracts'

export type EnvioNotificacion = Schema<'EnvioNotificacion'>
export type FiltrosEnvios = Omit<NonNullable<paths['/api/v1/notificaciones/envios']['get']['parameters']['query']>, 'cursor'>

/** Registro de envíos de notificaciones (`notify.envios`), por cliente, evento, canal o estado. */
export function useEnviosNotificacion() {
    const api = useApi()

    function listar(filtros: FiltrosEnvios = {}, cursor?: string): Promise<Resultado<Pagina<EnvioNotificacion>>> {
        const query: FiltrosEnvios & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/notificaciones/envios', { params: { query } }))
    }

    return { listar }
}
