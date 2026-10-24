import type { Schema, paths } from '@argosisp/contracts'

export type RecordatorioPago = Schema<'RecordatorioPago'>
export type CambiosRecordatorioPago = paths['/api/v1/notificaciones/recordatorios/{id}']['put']['requestBody']['content']['application/json']

/** Recordatorios de pago (hasta tres): días respecto al vencimiento, hora y activo. */
export function useRecordatoriosPago() {
    const api = useApi()

    function listar(): Promise<Resultado<RecordatorioPago[]>> {
        return resolver(api.GET('/api/v1/notificaciones/recordatorios'))
    }

    /** `PUT /notificaciones/recordatorios/:id` (`notificaciones.editar`) con la `version` leída. */
    function editar(id: number, cambios: CambiosRecordatorioPago): Promise<Resultado<RecordatorioPago>> {
        return resolver(api.PUT('/api/v1/notificaciones/recordatorios/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, editar }
}
