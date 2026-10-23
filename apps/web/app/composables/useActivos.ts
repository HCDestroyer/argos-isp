import type { Schema, paths } from '@argosisp/contracts'

export type ActivoFijo = Schema<'ActivoFijo'>
export type ResultadoCuotasMes = Schema<'ResultadoCuotasMes'>
export type FiltrosActivos = Omit<NonNullable<paths['/api/v1/activos']['get']['parameters']['query']>, 'cursor' | 'empresas'>
export type CuerpoActivo = paths['/api/v1/activos']['post']['requestBody']['content']['application/json']
export type CuerpoBajaActivo = paths['/api/v1/activos/{id}/dar-de-baja']['post']['requestBody']['content']['application/json']

/**
 * Activos fijos (A3, fase 5): un activo comprado nace con su compra (línea `activo_fijo`); el alta directa
 * es para el inventario inicial o un aporte. Depreciación en línea recta por mes (cron diario o
 * «Depreciar pendiente»); baja por venta o retiro con su asiento.
 */
export function useActivos() {
    const api = useApi()

    /** `GET /activos` (`activos.ver`). */
    function listar(filtros: FiltrosActivos = {}, cursor?: string): Promise<Resultado<Pagina<ActivoFijo>>> {
        return resolver(api.GET('/api/v1/activos', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /activos/:id` (`activos.ver`). */
    function ver(id: number): Promise<Resultado<ActivoFijo>> {
        return resolver(api.GET('/api/v1/activos/{id}', { params: { path: { id } } }))
    }

    /** `POST /activos` (`activos.registrar`): 422 `tasa_sobre_tope`. */
    function registrar(cuerpo: CuerpoActivo, idempotencia: string): Promise<Resultado<ActivoFijo>> {
        return resolver(api.POST('/api/v1/activos', { params: { header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `POST /activos/:id/dar-de-baja` (`activos.dar_de_baja`): deprecia lo pendiente y registra la baja. */
    function darDeBaja(id: number, cuerpo: CuerpoBajaActivo, idempotencia: string): Promise<Resultado<ActivoFijo>> {
        return resolver(api.POST('/api/v1/activos/{id}/dar-de-baja', { params: { path: { id }, header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `POST /activos/depreciar` (`activos.registrar`): las cuotas pendientes hasta el mes anterior (repetir no duplica). */
    function depreciar(hasta?: string): Promise<Resultado<ResultadoCuotasMes>> {
        return resolver(api.POST('/api/v1/activos/depreciar', { body: hasta ? { hasta } : {} }))
    }

    return { listar, ver, registrar, darDeBaja, depreciar }
}
