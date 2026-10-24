import type { Schema, paths } from '@argosisp/contracts'

export type Bodega = Schema<'Bodega'>
export type FiltrosBodegas = Omit<NonNullable<paths['/api/v1/bodegas']['get']['parameters']['query']>, 'cursor'>
export type DatosBodega = paths['/api/v1/bodegas']['post']['requestBody']['content']['application/json']
export type CambiosBodega = paths['/api/v1/bodegas/{id}/editar']['post']['requestBody']['content']['application/json']

/**
 * Bodegas del inventario (A3): un lugar (`bodega`) o un técnico (`tecnico`, con su usuario). La de
 * un técnico solo la mueve su usuario o quien tenga el permiso con alcance global (tope por técnico).
 */
export function useBodegas() {
    const api = useApi()

    function listar(filtros: FiltrosBodegas = {}, cursor?: string): Promise<Resultado<Pagina<Bodega>>> {
        const query: FiltrosBodegas & { cursor?: string } = { limit: 100, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bodegas', { params: { query } }))
    }

    /** Las activas de la empresa (para elegir en un formulario). */
    async function activas(): Promise<Resultado<Bodega[]>> {
        const resultado = await listar({ activo: true, limit: 200 })
        return resultado.ok ? { ok: true, data: resultado.data.data } : resultado
    }

    function ver(id: number): Promise<Resultado<Bodega>> {
        return resolver(api.GET('/api/v1/bodegas/{id}', { params: { path: { id } } }))
    }

    /** `POST /bodegas` (`bodegas.crear`): una de técnico lleva `usuario_id`. */
    function crear(datos: DatosBodega, claveIdempotencia: string): Promise<Resultado<Bodega>> {
        return resolver(api.POST('/api/v1/bodegas', { body: datos, params: { header: { 'Idempotency-Key': claveIdempotencia } } }))
    }

    /** `POST /bodegas/:id/editar` (`bodegas.editar`, con `version`): cambiar el técnico de una bodega con existencias es 409. */
    function editar(id: number, cambios: CambiosBodega): Promise<Resultado<Bodega>> {
        return resolver(api.POST('/api/v1/bodegas/{id}/editar', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /bodegas/:id/desactivar` (`bodegas.desactivar`): 409 `bodega_con_existencias`. */
    function desactivar(bodega: Pick<Bodega, 'id' | 'version'>, motivo: string | null): Promise<Resultado<Bodega>> {
        return resolver(api.POST('/api/v1/bodegas/{id}/desactivar', { params: { path: { id: bodega.id } }, body: { version: bodega.version, motivo } }))
    }

    return { listar, activas, ver, crear, editar, desactivar }
}
