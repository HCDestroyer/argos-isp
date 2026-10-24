import type { Schema, paths } from '@argosisp/contracts'

export type ConteoInventario = Schema<'ConteoInventario'>
export type ConteoInventarioDetalle = Schema<'ConteoInventarioDetalle'>
export type LineaConteo = ConteoInventarioDetalle['lineas'][number]
export type FiltrosConteos = Omit<NonNullable<paths['/api/v1/inventario/conteos']['get']['parameters']['query']>, 'cursor'>
export type DatosLineaConteo = paths['/api/v1/inventario/conteos/{id}/lineas']['post']['requestBody']['content']['application/json']

/**
 * Conteos físicos (A3, fase C): uno abierto por bodega; lo esperado se toma al capturar cada
 * línea; cerrar ajusta faltantes (`5.6.02`) y sobrantes (`4.2.04`) de los productos contados.
 */
export function useConteosInventario() {
    const api = useApi()

    function listar(filtros: FiltrosConteos = {}, cursor?: string): Promise<Resultado<Pagina<ConteoInventario>>> {
        const query: FiltrosConteos & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/inventario/conteos', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<ConteoInventarioDetalle>> {
        return resolver(api.GET('/api/v1/inventario/conteos/{id}', { params: { path: { id } } }))
    }

    /** `POST /inventario/conteos` (`inventario.abrir_conteo`): 409 `conteo_abierto` si la bodega ya tiene uno. */
    function abrir(bodegaId: number, motivo: string | null, clave: string): Promise<Resultado<ConteoInventarioDetalle>> {
        return resolver(api.POST('/api/v1/inventario/conteos', { body: { bodega_id: bodegaId, motivo }, params: { header: { 'Idempotency-Key': clave } } }))
    }

    /** `POST /inventario/conteos/:id/lineas` (`inventario.contar`): capturar otra vez reemplaza la línea. */
    function capturar(id: number, linea: DatosLineaConteo): Promise<Resultado<ConteoInventarioDetalle>> {
        return resolver(api.POST('/api/v1/inventario/conteos/{id}/lineas', { params: { path: { id } }, body: linea }))
    }

    /** `POST /inventario/conteos/:id/cerrar` (`inventario.cerrar_conteo`): ajusta las diferencias. */
    function cerrar(conteo: Pick<ConteoInventario, 'id' | 'version'>, clave: string): Promise<Resultado<ConteoInventarioDetalle>> {
        return resolver(api.POST('/api/v1/inventario/conteos/{id}/cerrar', {
            params: { path: { id: conteo.id }, header: { 'Idempotency-Key': clave } },
            body: { version: conteo.version },
        }))
    }

    /** `POST /inventario/conteos/:id/cancelar` (`inventario.cancelar_conteo`): sin ajustes. */
    function cancelar(id: number, motivo: string, clave: string): Promise<Resultado<ConteoInventarioDetalle>> {
        return resolver(api.POST('/api/v1/inventario/conteos/{id}/cancelar', {
            params: { path: { id }, header: { 'Idempotency-Key': clave } },
            body: { motivo },
        }))
    }

    return { listar, ver, abrir, capturar, cerrar, cancelar }
}
