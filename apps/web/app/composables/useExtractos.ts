import type { Schema, paths } from '@argosisp/contracts'

export type Extracto = Schema<'Extracto'>
export type LineaExtracto = Schema<'LineaExtracto'>
export type ResultadoAplicarReglas = Schema<'ResultadoAplicarReglas'>
export type DatosExtracto = paths['/api/v1/bancos/extractos']['post']['requestBody']['content']['application/json']
export type DatosRegistrarLinea = paths['/api/v1/bancos/extractos/lineas/{id}/registrar']['post']['requestBody']['content']['application/json']

/**
 * Extractos bancarios (A3, fase 4 §10.3), solo de inserción: importar (huella única por cuenta),
 * sus líneas con lo conciliado, aplicar reglas y registrar una línea sin documento (comisión,
 * interés) con un asiento nuevo que queda conciliado.
 */
export function useExtractos() {
    const api = useApi()

    function listar(cuentaId?: number, cursor?: string): Promise<Resultado<Pagina<Extracto>>> {
        const query: { limit: number, cuenta_id?: number, cursor?: string } = { limit: 25 }
        if (cuentaId) {
            query.cuenta_id = cuentaId
        }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bancos/extractos', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Extracto>> {
        return resolver(api.GET('/api/v1/bancos/extractos/{id}', { params: { path: { id } } }))
    }

    function lineas(id: number): Promise<Resultado<LineaExtracto[]>> {
        return resolver(api.GET('/api/v1/bancos/extractos/{id}/lineas', { params: { path: { id } } }))
    }

    /**
     * `POST /bancos/extractos` (`bancos.importar_extracto`): 422 `extracto_descuadrado` (Σ líneas ≠
     * final − inicial), 422 `extracto_no_encadena` (reintentar con `motivo_no_encadena`) y 409
     * `extracto_duplicado` con `errors[]` por línea.
     */
    function importar(datos: DatosExtracto, claveIdempotencia: string): Promise<Resultado<Extracto>> {
        return resolver(api.POST('/api/v1/bancos/extractos', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `POST /bancos/extractos/:id/aplicar-reglas` (`bancos.conciliar`). */
    function aplicarReglas(id: number, claveIdempotencia: string): Promise<Resultado<ResultadoAplicarReglas>> {
        return resolver(api.POST('/api/v1/bancos/extractos/{id}/aplicar-reglas', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /**
     * `POST /bancos/extractos/lineas/:id/registrar` (`bancos.conciliar`): cargo → `5.3.07` por
     * defecto; abono → contrapartida obligatoria. 409 `linea_conciliada`/`linea_registrada`.
     */
    function registrarLinea(lineaId: number, datos: DatosRegistrarLinea, claveIdempotencia: string): Promise<Resultado<Conciliacion>> {
        return resolver(api.POST('/api/v1/bancos/extractos/lineas/{id}/registrar', {
            params: { path: { id: lineaId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { listar, ver, lineas, importar, aplicarReglas, registrarLinea }
}
