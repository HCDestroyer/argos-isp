import type { Schema, paths } from '@argosisp/contracts'

export type AdicionalServicio = Schema<'AdicionalServicio'>
export type CredencialAdicional = Schema<'CredencialAdicional'>
export type BloqueoAdicional = Schema<'BloqueoAdicional'>
export type EstadoAdicionalServicio = AdicionalServicio['estado']
export type DatosAdicionalServicio = paths['/api/v1/servicios/{id}/adicionales']['post']['requestBody']['content']['application/json']
export type CambiosAdicionalServicio = paths['/api/v1/servicios/{id}/adicionales/{asignacionId}']['put']['requestBody']['content']['application/json']

/**
 * Adicionales asignados a un servicio (A1, `contratos/adicionales.md`): incluido, cortesía o
 * cobrado. Las listas nunca traen la credencial (`tiene_credencial`); se lee aparte, auditada.
 */
export function useAdicionalesServicio() {
    const api = useApi()

    function listar(servicioId: number, estado?: EstadoAdicionalServicio, cursor?: string): Promise<Resultado<Pagina<AdicionalServicio>>> {
        const query: { limit: number, estado?: EstadoAdicionalServicio, cursor?: string } = { limit: 100 }
        if (estado) {
            query.estado = estado
        }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/servicios/{id}/adicionales', { params: { path: { id: servicioId }, query } }))
    }

    /**
     * `GET /servicios/:id/adicionales/:asignacionId/bloqueos` (`servicios.ver`): bloqueos y
     * desbloqueos por la suspensión del servicio, del más reciente al más viejo.
     */
    function bloqueos(servicioId: number, asignacionId: number, cursor?: string): Promise<Resultado<Pagina<BloqueoAdicional>>> {
        const query: { limit: number, cursor?: string } = { limit: 25 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/servicios/{id}/adicionales/{asignacionId}/bloqueos', { params: { path: { id: servicioId, asignacionId }, query } }))
    }

    /**
     * `POST /servicios/:id/adicionales` (`servicios.agregar_adicional`; la cortesía pide además
     * `servicios.adicional_cortesia`). 422 `adicional_de_otra_empresa`, `adicional_inactivo`,
     * `servicio_retirado`.
     */
    function agregar(servicioId: number, datos: DatosAdicionalServicio, claveIdempotencia: string): Promise<Resultado<AdicionalServicio>> {
        return resolver(api.POST('/api/v1/servicios/{id}/adicionales', {
            params: { path: { id: servicioId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `PUT …/:asignacionId` (`servicios.editar_adicional`) con `version`; `credencial: null` la borra. */
    function editar(servicioId: number, asignacionId: number, cambios: CambiosAdicionalServicio): Promise<Resultado<AdicionalServicio>> {
        return resolver(api.PUT('/api/v1/servicios/{id}/adicionales/{asignacionId}', {
            params: { path: { id: servicioId, asignacionId } },
            body: cambios,
        }))
    }

    /** `POST …/:asignacionId/quitar` (`servicios.quitar_adicional`): baja con fecha, nunca se borra. */
    function quitar(servicioId: number, asignacionId: number, version: number, motivo: string | null, claveIdempotencia: string): Promise<Resultado<AdicionalServicio>> {
        return resolver(api.POST('/api/v1/servicios/{id}/adicionales/{asignacionId}/quitar', {
            params: { path: { id: servicioId, asignacionId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { version, motivo },
        }))
    }

    /** `GET …/credencial` (`servicios.ver_credencial_adicional`): en claro y auditado; 422 `sin_credencial`. */
    function credencial(servicioId: number, asignacionId: number): Promise<Resultado<CredencialAdicional>> {
        return resolver(api.GET('/api/v1/servicios/{id}/adicionales/{asignacionId}/credencial', { params: { path: { id: servicioId, asignacionId } } }))
    }

    return { listar, bloqueos, agregar, editar, quitar, credencial }
}
