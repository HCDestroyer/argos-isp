import type { Schema, paths } from '@argosisp/contracts'

export type Producto = Schema<'Producto'>
export type FiltrosProductos = Omit<NonNullable<paths['/api/v1/productos']['get']['parameters']['query']>, 'cursor'>
export type DatosProducto = paths['/api/v1/productos']['post']['requestBody']['content']['application/json']
export type CuerpoProductosLote = paths['/api/v1/productos/lote']['post']['requestBody']['content']['application/json']
export type ProductosLote = Schema<'ProductosLote'>
export type CambiosProducto = paths['/api/v1/productos/{id}/editar']['post']['requestBody']['content']['application/json']

/**
 * Productos del inventario (A3, `contratos/inventario.md` §6): SKU único por empresa, tipo,
 * seguimiento por cantidad o por serie, clase de activo para el comodato y existencia mínima.
 * Se desactivan (con existencia 0), nunca se borran.
 */
export function useProductos() {
    const api = useApi()

    function listar(filtros: FiltrosProductos = {}, cursor?: string): Promise<Resultado<Pagina<Producto>>> {
        const query: FiltrosProductos & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/productos', { params: { query } }))
    }

    /** Los activos de la empresa (para elegir en un formulario; el catálogo es corto). */
    async function activos(filtros: FiltrosProductos = {}): Promise<Resultado<Producto[]>> {
        const resultado = await listar({ ...filtros, activo: true, limit: 200 })
        return resultado.ok ? { ok: true, data: resultado.data.data } : resultado
    }

    function ver(id: number): Promise<Resultado<Producto>> {
        return resolver(api.GET('/api/v1/productos/{id}', { params: { path: { id } } }))
    }

    /** `POST /productos` (`productos.crear`): 409 si el SKU ya existe en la empresa. */
    function crear(datos: DatosProducto, claveIdempotencia: string): Promise<Resultado<Producto>> {
        return resolver(api.POST('/api/v1/productos', { body: datos, params: { header: { 'Idempotency-Key': claveIdempotencia } } }))
    }

    /** `POST /productos/:id/editar` (`productos.editar`, con `version`): el seguimiento no cambia con movimientos. */
    function editar(id: number, cambios: CambiosProducto): Promise<Resultado<Producto>> {
        return resolver(api.POST('/api/v1/productos/{id}/editar', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /productos/:id/desactivar` (`productos.desactivar`): 409 `producto_con_existencias`. */
    function desactivar(producto: Pick<Producto, 'id' | 'version'>, motivo: string | null): Promise<Resultado<Producto>> {
        return resolver(api.POST('/api/v1/productos/{id}/desactivar', { params: { path: { id: producto.id } }, body: { version: producto.version, motivo } }))
    }

    /**
     * `POST /productos/lote` (`productos.crear_lote`, D.4): hasta 500, todo o nada; la `Idempotency-Key`
     * es obligatoria (400 sin ella). Errores por fila en `productos.<i>.campo`.
     */
    function crearLote(cuerpo: CuerpoProductosLote, claveIdempotencia: string): Promise<Resultado<ProductosLote>> {
        return resolver(api.POST('/api/v1/productos/lote', { body: cuerpo, params: { header: { 'Idempotency-Key': claveIdempotencia } } }))
    }

    return { listar, activos, ver, crear, crearLote, editar, desactivar }
}
