import type { Schema, paths } from '@argosisp/contracts'

export type PromocionVelocidad = Schema<'PromocionVelocidad'>
export type PromocionServicio = Schema<'PromocionServicio'>
export type PaginaPromocionesVelocidad = Schema<'PaginaPromocionesVelocidad'>
export type VigenciaPromocion = PromocionVelocidad['vigencia']
export type FiltrosPromociones = Omit<NonNullable<paths['/api/v1/promociones-velocidad']['get']['parameters']['query']>, 'cursor'>
export type DatosPromocionVelocidad = paths['/api/v1/promociones-velocidad']['post']['requestBody']['content']['application/json']

/**
 * Promociones de velocidad (decisiones del PM 18 y 34; rutas de `operacion_pm.ts`, A1): lista por
 * pestaña con sus conteos, alta, servicios con la promoción, asignar, quitar y cancelar. Cada
 * acción con su permiso del mismo nombre (`promociones_velocidad.asignar`…) e `Idempotency-Key`.
 */
export function usePromocionesVelocidad() {
    const api = useApi()

    /** `GET /promociones-velocidad` (`promociones_velocidad.ver`): página con `conteos` de las cuatro pestañas. */
    function listar(filtros: FiltrosPromociones = {}, cursor?: string): Promise<Resultado<PaginaPromocionesVelocidad>> {
        const query: FiltrosPromociones & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/promociones-velocidad', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<PromocionVelocidad>> {
        return resolver(api.GET('/api/v1/promociones-velocidad/{id}', { params: { path: { id } } }))
    }

    /**
     * `POST /promociones-velocidad` (`promociones_velocidad.crear`). Con `servicio_ids` la asigna en
     * la misma transacción: todo o nada (422 con el código de la regla y el servicio que falla).
     */
    function crear(datos: DatosPromocionVelocidad, claveIdempotencia: string): Promise<Resultado<PromocionVelocidad>> {
        return resolver(api.POST('/api/v1/promociones-velocidad', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `GET /promociones-velocidad/:id/servicios`: vigentes y quitados, con el tramo abierto. */
    function servicios(id: number, cursor?: string): Promise<Resultado<Pagina<PromocionServicio>>> {
        return resolver(api.GET('/api/v1/promociones-velocidad/{id}/servicios', {
            params: { path: { id }, query: { limit: 50, ...(cursor ? { cursor } : {}) } },
        }))
    }

    /** `POST /promociones-velocidad/:id/servicios` (`promociones_velocidad.asignar`): todo o nada. */
    function asignar(id: number, servicioIds: number[], claveIdempotencia: string): Promise<Resultado<PromocionVelocidad>> {
        return resolver(api.POST('/api/v1/promociones-velocidad/{id}/servicios', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { servicio_ids: servicioIds },
        }))
    }

    /** `POST /promociones-velocidad/:id/servicios/:servicioId/quitar` (`promociones_velocidad.quitar`). */
    function quitar(id: number, servicioId: number, motivo: string | null, claveIdempotencia: string): Promise<Resultado<PromocionVelocidad>> {
        return resolver(api.POST('/api/v1/promociones-velocidad/{id}/servicios/{servicioId}/quitar', {
            params: { path: { id, servicioId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /** `POST /promociones-velocidad/:id/cancelar` (`promociones_velocidad.cancelar`) con la `version` leída; 409 si cambió. */
    function cancelar(id: number, version: number, motivo: string, claveIdempotencia: string): Promise<Resultado<PromocionVelocidad>> {
        return resolver(api.POST('/api/v1/promociones-velocidad/{id}/cancelar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { version, motivo },
        }))
    }

    /** `GET /servicios/:id/promociones-velocidad` (`servicios.ver`): las del servicio, con el tramo en curso. */
    function delServicio(servicioId: number, cursor?: string): Promise<Resultado<Pagina<PromocionServicio>>> {
        return resolver(api.GET('/api/v1/servicios/{id}/promociones-velocidad', {
            params: { path: { id: servicioId }, query: { limit: 50, ...(cursor ? { cursor } : {}) } },
        }))
    }

    return { listar, ver, crear, servicios, asignar, quitar, cancelar, delServicio }
}
