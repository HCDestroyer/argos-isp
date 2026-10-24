import type { Schema, paths } from '@argosisp/contracts'

export type PlantillaNotificacion = Schema<'PlantillaNotificacion'>
export type CambiosPlantillaNotificacion = paths['/api/v1/notificaciones/plantillas/{id}']['put']['requestBody']['content']['application/json']

/** Plantillas de notificación por evento y canal (A6): lista y edición de asunto, cuerpo y activa. */
export function usePlantillasNotificacion() {
    const api = useApi()

    function listar(): Promise<Resultado<PlantillaNotificacion[]>> {
        return resolver(api.GET('/api/v1/notificaciones/plantillas'))
    }

    /** `PUT /notificaciones/plantillas/:id` (`notificaciones.editar`): Mustache inválido 422 por campo; 409 si cambió. */
    function editar(id: number, cambios: CambiosPlantillaNotificacion): Promise<Resultado<PlantillaNotificacion>> {
        return resolver(api.PUT('/api/v1/notificaciones/plantillas/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, editar }
}
