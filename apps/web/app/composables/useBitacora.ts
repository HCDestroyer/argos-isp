import type { Schema, paths } from '@argosisp/contracts'

export type AccionAuditoria = Schema<'AccionAuditoria'>
export type FiltrosAcciones = Omit<NonNullable<paths['/api/v1/bitacora/acciones']['get']['parameters']['query']>, 'cursor'>
export type CambioAuditoria = Schema<'CambioAuditoria'>
export type FiltrosCambios = Omit<NonNullable<paths['/api/v1/bitacora/cambios']['get']['parameters']['query']>, 'cursor'>
export type CanalAccion = NonNullable<FiltrosAcciones['canal']>

/**
 * Bitácora de acciones (`audit.acciones`). Con `cliente_id` la API junta el cliente y sus
 * servicios, facturas, pagos y promesas; `excluir_canal: 'portal'` deja fuera las lecturas del portal.
 */
export function useBitacora() {
    const api = useApi()

    function acciones(filtros: FiltrosAcciones = {}, cursor?: string): Promise<Resultado<Pagina<AccionAuditoria>>> {
        const query: FiltrosAcciones & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bitacora/acciones', { params: { query } }))
    }

    /** Historial de cambios por campo (`audit.cambios`); los datos sensibles llegan como `***`. */
    function cambios(filtros: FiltrosCambios = {}, cursor?: string): Promise<Resultado<Pagina<CambioAuditoria>>> {
        const query: FiltrosCambios & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bitacora/cambios', { params: { query } }))
    }

    return { acciones, cambios }
}
