import type { Schema, paths } from '@argosisp/contracts'

export type TipoProducto = Schema<'TipoProducto'>
export type CuerpoTipoProducto = paths['/api/v1/inventario/tipos-producto']['post']['requestBody']['content']['application/json']
export type CambiosTipoProducto = paths['/api/v1/inventario/tipos-producto/{id}/editar']['post']['requestBody']['content']['application/json']

/**
 * Tipos de producto editables (A3, `contratos/inventario.md` D.2): código (no cambia), nombre,
 * seguimiento y modalidad por defecto. Los globales (`empresa_id` null) solo con alcance global.
 * Se desactivan, nunca se borran; los productos que ya los usan siguen igual.
 */
export function useTiposProducto() {
    const api = useApi()

    function listar(filtros: { activo?: boolean } = {}, cursor?: string): Promise<Resultado<Pagina<TipoProducto>>> {
        return resolver(api.GET('/api/v1/inventario/tipos-producto', { params: { query: { limit: 200, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** Los activos (para elegir en el formulario del producto). */
    async function activos(): Promise<Resultado<TipoProducto[]>> {
        const resultado = await listar({ activo: true })
        return resultado.ok ? { ok: true, data: resultado.data.data } : resultado
    }

    /** `POST /inventario/tipos-producto` (`tipos_producto.crear`): 409 si el código ya existe. */
    function crear(cuerpo: CuerpoTipoProducto, clave: string): Promise<Resultado<TipoProducto>> {
        return resolver(api.POST('/api/v1/inventario/tipos-producto', { params: { header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    /** `POST /inventario/tipos-producto/:id/editar` (`tipos_producto.editar`, con `version`). */
    function editar(id: number, cambios: CambiosTipoProducto): Promise<Resultado<TipoProducto>> {
        return resolver(api.POST('/api/v1/inventario/tipos-producto/{id}/editar', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /inventario/tipos-producto/:id/desactivar` (`tipos_producto.desactivar`, con `version`). */
    function desactivar(tipo: Pick<TipoProducto, 'id' | 'version'>, motivo: string | null): Promise<Resultado<TipoProducto>> {
        return resolver(api.POST('/api/v1/inventario/tipos-producto/{id}/desactivar', { params: { path: { id: tipo.id } }, body: { version: tipo.version, motivo } }))
    }

    return { listar, activos, crear, editar, desactivar }
}
