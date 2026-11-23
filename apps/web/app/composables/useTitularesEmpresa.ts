import type { Schema, paths } from '@argosisp/contracts'

export type RevisionTitularEmpresa = Schema<'RevisionTitularEmpresa'>
export type RevisionTitularEmpresaDetalle = Schema<'RevisionTitularEmpresaDetalle'>
export type TitularEmpresaAprobado = Schema<'TitularEmpresaAprobado'>
export type EstadoRevisionTitular = RevisionTitularEmpresa['estado']
export type DatosAprobarTitular = paths['/api/v1/titulares-empresa/revisiones/{id}/aprobar']['post']['requestBody']['content']['application/json']
export type DatosRechazarTitular = paths['/api/v1/titulares-empresa/revisiones/{id}/rechazar']['post']['requestBody']['content']['application/json']

/** Tamaño de página de la lista de revisiones. */
export const LIMITE_REVISIONES_TITULAR = 20

/**
 * Revisión de cambios de titular a una empresa (A1, contrato Iris 0.14.1): los que quedaron en
 * `422 titular_empresa_en_revision`. Leer pide `clientes.ver_identidad` y cada vista del detalle y
 * de las fotos queda en la bitácora; aprobar y rechazar piden además su propio permiso.
 */
export function useTitularesEmpresa() {
    const api = useApi()

    function listar(estado: EstadoRevisionTitular | undefined, cursor?: string): Promise<Resultado<Pagina<RevisionTitularEmpresa>>> {
        const query: { limit: number, estado?: EstadoRevisionTitular, cursor?: string } = { limit: LIMITE_REVISIONES_TITULAR }
        if (estado) {
            query.estado = estado
        }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/titulares-empresa/revisiones', { params: { query } }))
    }

    /** El detalle con el documento y el nombre del representante (queda auditado). */
    function ver(id: number): Promise<Resultado<RevisionTitularEmpresaDetalle>> {
        return resolver(api.GET('/api/v1/titulares-empresa/revisiones/{id}', { params: { path: { id } } }))
    }

    /** Foto del documento del representante como `Blob` (va con la cookie de sesión; queda auditada). */
    function foto(id: number, parte: 'frente' | 'reverso'): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/titulares-empresa/revisiones/{id}/fotos/{parte}', {
            params: { path: { id, parte } },
            parseAs: 'blob',
        }))
    }

    /** `POST …/aprobar` con `Idempotency-Key`; con varios candidatos, `cliente_id` es obligatorio. */
    function aprobar(id: number, datos: DatosAprobarTitular, claveIdempotencia: string): Promise<Resultado<TitularEmpresaAprobado>> {
        return resolver(api.POST('/api/v1/titulares-empresa/revisiones/{id}/aprobar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `POST …/rechazar` con `Idempotency-Key`: el servicio sigue con su titular. */
    function rechazar(id: number, datos: DatosRechazarTitular, claveIdempotencia: string): Promise<Resultado<RevisionTitularEmpresa>> {
        return resolver(api.POST('/api/v1/titulares-empresa/revisiones/{id}/rechazar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { listar, ver, foto, aprobar, rechazar }
}
