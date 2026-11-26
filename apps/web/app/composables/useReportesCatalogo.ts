import type { Schema } from '@argosisp/contracts'

export type ReporteCatalogo = Schema<'ReporteCatalogo'>

/**
 * Catálogo de reportes que el usuario puede ver, con sus favoritos primero (A3): lo que dice cuáles
 * se pueden marcar, enviar a un correo externo y en qué formatos se descargan. El favorito es una
 * preferencia propia: no tiene permiso del ACL, la ruta pide `reportes.ver`.
 */
export function useReportesCatalogo() {
    const api = useApi()

    /** `GET /reportes/catalogo`: solo los reportes que el usuario puede ver. */
    function listar(): Promise<Resultado<ReporteCatalogo[]>> {
        return resolver(api.GET('/api/v1/reportes/catalogo'))
    }

    /** `PUT` o `DELETE /reportes/favoritos/:reporte`: marcar es idempotente (dos veces no cambia nada). */
    function favorito(codigo: string, activo: boolean): Promise<Resultado<{ favorito: boolean }>> {
        const params = { path: { reporte: codigo }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } }
        return resolver(activo
            ? api.PUT('/api/v1/reportes/favoritos/{reporte}', { params })
            : api.DELETE('/api/v1/reportes/favoritos/{reporte}', { params }))
    }

    return { listar, favorito }
}
