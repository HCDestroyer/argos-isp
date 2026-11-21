import type { Schema, paths } from '@argosisp/contracts'

export type EquipoServicio = Schema<'EquipoServicio'>
export type DatosCambioEquipo = paths['/api/v1/servicios/{id}/equipos/cambiar']['post']['requestBody']['content']['application/json']
export type CambioEquipo = Schema<'CambioEquipo'>
export type DatosDevolucionEquipo = paths['/api/v1/servicios/{id}/equipos/{unidadId}/devolver']['post']['requestBody']['content']['application/json']

/**
 * Equipos en comodato de un servicio (A3, fase B): asignar una unidad disponible, devolverla a una
 * bodega (nueva o usada, o a reparación) o declararla perdida. Asignar da de alta su activo fijo.
 */
export function useEquiposServicio() {
    const api = useApi()

    function listar(servicioId: number): Promise<Resultado<EquipoServicio[]>> {
        return resolver(api.GET('/api/v1/servicios/{id}/equipos', { params: { path: { id: servicioId } } }))
    }

    /** `POST /servicios/:id/equipos` (`inventario.asignar_comodato`): 409 `servicio_retirado`. */
    function asignar(servicioId: number, unidadId: number, fecha: string | null, clave: string): Promise<Resultado<Schema<'UnidadInventario'>>> {
        return resolver(api.POST('/api/v1/servicios/{id}/equipos', {
            params: { path: { id: servicioId }, header: { 'Idempotency-Key': clave } },
            body: { unidad_id: unidadId, fecha },
        }))
    }

    /** `POST /servicios/:id/equipos/:unidadId/devolver` (`inventario.devolver_comodato`). */
    function devolver(servicioId: number, unidadId: number, datos: DatosDevolucionEquipo, clave: string): Promise<Resultado<Schema<'UnidadInventario'>>> {
        return resolver(api.POST('/api/v1/servicios/{id}/equipos/{unidadId}/devolver', {
            params: { path: { id: servicioId, unidadId }, header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    /** `POST /servicios/:id/equipos/:unidadId/perdida` (`inventario.declarar_perdida_comodato`): baja del activo. */
    function declararPerdida(servicioId: number, unidadId: number, motivo: string, clave: string): Promise<Resultado<Schema<'UnidadInventario'>>> {
        return resolver(api.POST('/api/v1/servicios/{id}/equipos/{unidadId}/perdida', {
            params: { path: { id: servicioId, unidadId }, header: { 'Idempotency-Key': clave } },
            body: { motivo },
        }))
    }

    /**
     * `POST /servicios/:id/equipos/cambiar` (`servicios.cambiar_equipo`, contrato Iris A48): sale uno y
     * entra otro en una sola transacción; el que sale va a disponible, revisión o garantía, nunca a
     * baja. Un 409 no se reintenta: se vuelve a leer la lista.
     */
    function cambiar(servicioId: number, datos: DatosCambioEquipo, clave: string): Promise<Resultado<CambioEquipo>> {
        return resolver(api.POST('/api/v1/servicios/{id}/equipos/cambiar', {
            params: { path: { id: servicioId }, header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    return { listar, asignar, devolver, declararPerdida, cambiar }
}
