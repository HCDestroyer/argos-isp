import type { Schema, paths } from '@argosisp/contracts'

export type Extracto = Schema<'Extracto'>
export type LineaExtracto = Schema<'LineaExtracto'>
export type ResultadoAplicarReglas = Schema<'ResultadoAplicarReglas'>
export type DatosExtracto = paths['/api/v1/bancos/extractos']['post']['requestBody']['content']['application/json']
export type VistaPreviaExtracto = Schema<'VistaPreviaExtracto'>
export type MapeoExtracto = Schema<'MapeoExtracto'>
export type ExtractoDesdeArchivo = Schema<'ExtractoDesdeArchivo'>
export type MapeoExtractoGuardado = Schema<'MapeoExtractoGuardado'>
export type DatosRegistrarLinea = paths['/api/v1/bancos/extractos/lineas/{id}/registrar']['post']['requestBody']['content']['application/json']

/** Estado de cuenta del banco para la vista previa o la importación (multipart). */
export interface ArchivoExtracto {
    cuentaBancariaId: number
    archivo: File
    mapeo?: MapeoExtracto | null
    guardarMapeo?: boolean
    motivoNoEncadena?: string | null
}

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

    /** Campos multipart del estado de cuenta tal como lo descarga el banco. */
    function formularioArchivo(datos: ArchivoExtracto): FormData {
        const formulario = new FormData()
        formulario.append('cuenta_bancaria_id', String(datos.cuentaBancariaId))
        formulario.append('archivo', datos.archivo, datos.archivo.name)
        if (datos.mapeo) {
            formulario.append('mapeo', JSON.stringify(datos.mapeo))
        }
        if (datos.guardarMapeo !== undefined) {
            formulario.append('guardar_mapeo', String(datos.guardarMapeo))
        }
        if (datos.motivoNoEncadena) {
            formulario.append('motivo_no_encadena', datos.motivoNoEncadena)
        }
        return formulario
    }

    /**
     * `POST /bancos/extractos/vista-previa` (`bancos.importar_extracto`): lee el archivo del banco
     * sin importar nada; reconoce el banco o sugiere el mapeo (`requiere_confirmacion`). 422
     * `archivo_no_legible` y `mapeo_invalido`.
     */
    function vistaPrevia(datos: ArchivoExtracto): Promise<Resultado<VistaPreviaExtracto>> {
        return resolver(api.POST('/api/v1/bancos/extractos/vista-previa', {
            body: { cuenta_bancaria_id: datos.cuentaBancariaId, archivo: datos.archivo.name },
            bodySerializer: () => formularioArchivo(datos),
        }))
    }

    /**
     * `POST /bancos/extractos/archivo` (`bancos.importar_extracto`): importa el archivo tal cual y
     * guarda el mapeo para la cuenta (salvo `guardarMapeo: false`). 422 `formato_no_reconocido`,
     * `extracto_con_errores`, `extracto_descuadrado`, `extracto_no_encadena`; 409 `extracto_duplicado`.
     */
    function importarArchivo(datos: ArchivoExtracto, claveIdempotencia: string): Promise<Resultado<ExtractoDesdeArchivo>> {
        return resolver(api.POST('/api/v1/bancos/extractos/archivo', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: { cuenta_bancaria_id: datos.cuentaBancariaId, archivo: datos.archivo.name },
            bodySerializer: () => formularioArchivo(datos),
        }))
    }

    return { listar, ver, lineas, importar, aplicarReglas, registrarLinea, vistaPrevia, importarArchivo }
}
