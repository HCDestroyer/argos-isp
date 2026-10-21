import type { paths } from '@argosisp/contracts'

type CuerpoBloquear = paths['/api/v1/libro/bloqueos']['post']['requestBody']['content']['application/json']
type CuerpoDuro = paths['/api/v1/libro/bloqueos/duro']['post']['requestBody']['content']['application/json']
type CuerpoDesbloquear = paths['/api/v1/libro/bloqueos/desbloquear']['post']['requestBody']['content']['application/json']
type CuerpoExcepcion = paths['/api/v1/libro/bloqueos/excepciones']['post']['requestBody']['content']['application/json']
export type FiltrosHistorialBloqueos = Omit<NonNullable<paths['/api/v1/libro/bloqueos/historial']['get']['parameters']['query']>, 'cursor'>
export type FiltrosExcepcionesBloqueo = Omit<NonNullable<paths['/api/v1/libro/bloqueos/excepciones']['get']['parameters']['query']>, 'cursor'>

/**
 * Bloqueos del libro (A3, fase 6 PR A): el vigente de cada tipo por empresa, su historial, bloquear,
 * el bloqueo duro con confirmación de texto, desbloquear con motivo y las excepciones con fecha de
 * fin. Cada acción manda su `Idempotency-Key`; la empresa es la activa (`X-Empresa-Id`).
 */
export function useBloqueosLibro() {
    const api = useApi()

    /** `GET /libro/bloqueos` (`libro.ver`): una fila por empresa con el `hasta` vigente de cada tipo. */
    function vigentes(): Promise<Resultado<BloqueosEmpresa[]>> {
        return resolver(api.GET('/api/v1/libro/bloqueos'))
    }

    function historial(filtros: FiltrosHistorialBloqueos = {}, cursor?: string): Promise<Resultado<Pagina<BloqueoLibro>>> {
        const query: FiltrosHistorialBloqueos & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libro/bloqueos/historial', { params: { query } }))
    }

    /** `libro.bloquear`: solo avanza (422 `bloqueo_regresivo`), no futuro, nunca antes del duro. */
    function bloquear(cuerpo: CuerpoBloquear, claveIdempotencia: string): Promise<Resultado<BloqueoLibro>> {
        return resolver(api.POST('/api/v1/libro/bloqueos', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** `libro.bloquear_duro`: con la confirmación «BLOQUEO DURO hasta AAAA-MM-DD» y sus requisitos. */
    function bloquearDuro(cuerpo: CuerpoDuro, claveIdempotencia: string): Promise<Resultado<BloqueoLibro>> {
        return resolver(api.POST('/api/v1/libro/bloqueos/duro', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** `libro.desbloquear`: global, ventas o compras a una fecha anterior o sin bloqueo, con motivo. */
    function desbloquear(cuerpo: CuerpoDesbloquear, claveIdempotencia: string): Promise<Resultado<BloqueoLibro>> {
        return resolver(api.POST('/api/v1/libro/bloqueos/desbloquear', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    function excepciones(filtros: FiltrosExcepcionesBloqueo = {}, cursor?: string): Promise<Resultado<Pagina<ExcepcionBloqueo>>> {
        const query: FiltrosExcepcionesBloqueo & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libro/bloqueos/excepciones', { params: { query } }))
    }

    /** `libro.excepcion_bloqueo` (solo admin): siempre con fin; nunca para el duro (422 `excepcion_sin_fin`). */
    function crearExcepcion(cuerpo: CuerpoExcepcion, claveIdempotencia: string): Promise<Resultado<ExcepcionBloqueo>> {
        return resolver(api.POST('/api/v1/libro/bloqueos/excepciones', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** Desde ahora no cubre asientos nuevos (409 `excepcion_revocada` si ya lo estaba). */
    function revocarExcepcion(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<ExcepcionBloqueo>> {
        return resolver(api.POST('/api/v1/libro/bloqueos/excepciones/{id}/revocar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    return { vigentes, historial, bloquear, bloquearDuro, desbloquear, excepciones, crearExcepcion, revocarExcepcion }
}
