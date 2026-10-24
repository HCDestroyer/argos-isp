import type { Schema } from '@argosisp/contracts'

export type EventoNotificacion = Schema<'EventoNotificacion'>
export type GrupoEvento = EventoNotificacion['grupo']

/**
 * Catálogo de eventos con plantilla (A6, `GET /notificaciones/eventos`): nombre en español, grupo,
 * canales de fábrica y las variables Mustache con su ejemplo, las mismas que arma el aviso real.
 */
export function useEventosNotificacion() {
    const api = useApi()

    function listar(): Promise<Resultado<EventoNotificacion[]>> {
        return resolver(api.GET('/api/v1/notificaciones/eventos'))
    }

    return { listar }
}
