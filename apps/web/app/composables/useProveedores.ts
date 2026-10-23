import type { Schema, paths } from '@argosisp/contracts'

export type Proveedor = Schema<'Proveedor'>
export type EstadoCuentaProveedor = Schema<'EstadoCuentaProveedor'>
export type FiltrosProveedores = Omit<NonNullable<paths['/api/v1/proveedores']['get']['parameters']['query']>, 'cursor' | 'empresas'>
export type CuerpoProveedor = paths['/api/v1/proveedores']['post']['requestBody']['content']['application/json']
export type CuerpoEditarProveedor = paths['/api/v1/proveedores/{id}']['put']['requestBody']['content']['application/json']

/**
 * Proveedores (A3, fase 5; contrato fiscal §19). `saldo` es el de su auxiliar en 2.1.03 (lo que la
 * empresa le debe). El documento y el país no se editan; la edición lleva `version` (409).
 */
export function useProveedores() {
    const api = useApi()

    /** `GET /proveedores` (`proveedores.ver`). */
    function listar(filtros: FiltrosProveedores = {}, cursor?: string): Promise<Resultado<Pagina<Proveedor>>> {
        return resolver(api.GET('/api/v1/proveedores', { params: { query: { limit: 25, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /proveedores/:id` (`proveedores.ver`). */
    function ver(id: number): Promise<Resultado<Proveedor>> {
        return resolver(api.GET('/api/v1/proveedores/{id}', { params: { path: { id } } }))
    }

    /** `GET /proveedores/:id/estado-cuenta` (`proveedores.ver`): movimientos del auxiliar y lo pendiente. */
    function estadoCuenta(id: number, rango: { desde?: string, hasta?: string } = {}): Promise<Resultado<EstadoCuentaProveedor>> {
        return resolver(api.GET('/api/v1/proveedores/{id}/estado-cuenta', { params: { path: { id }, query: rango } }))
    }

    /** `POST /proveedores` (`proveedores.editar`): 409 `proveedor_duplicado`. */
    function crear(cuerpo: CuerpoProveedor, idempotencia: string): Promise<Resultado<Proveedor>> {
        return resolver(api.POST('/api/v1/proveedores', { params: { header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `PUT /proveedores/:id` (`proveedores.editar`): con `version`; 409 si cambió. */
    function editar(id: number, cuerpo: CuerpoEditarProveedor, idempotencia: string): Promise<Resultado<Proveedor>> {
        return resolver(api.PUT('/api/v1/proveedores/{id}', { params: { path: { id }, header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    return { listar, ver, estadoCuenta, crear, editar }
}
