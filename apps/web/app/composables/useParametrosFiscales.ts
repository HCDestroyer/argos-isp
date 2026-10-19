import type { Schema, paths } from '@argosisp/contracts'

export type ParametroFiscal = Schema<'ParametroFiscal'>
export type ValorParametroFiscal = Schema<'ValorParametroFiscal'>
export type HistorialParametroFiscal = Schema<'HistorialParametroFiscal'>
export type ValorParametroCreado = Schema<'ValorParametroCreado'>
export type RegimenCambiado = Schema<'RegimenCambiado'>
export type CuerpoValorParametro = paths['/api/v1/fiscal/parametros/{clave}/valores']['post']['requestBody']['content']['application/json']
export type CuerpoRegimen = paths['/api/v1/fiscal/regimen']['post']['requestBody']['content']['application/json']

/**
 * Parámetros fiscales con vigencia de la empresa activa (A3, fase 2). Editar es **insertar** un
 * valor con `vigente_desde`: lo anterior no cambia. El régimen es un parámetro con acción propia
 * (`POST /fiscal/regimen`, `fiscal.cambiar_regimen`).
 */
export function useParametrosFiscales() {
    const api = useApi()

    /** `GET /fiscal/parametros?fecha=` (`fiscal.ver`): valor vigente con su nivel, fuente y marca de contador. */
    function listar(fecha?: string): Promise<Resultado<Schema<'ParametrosFiscales'>>> {
        return resolver(api.GET('/api/v1/fiscal/parametros', { params: { query: fecha ? { fecha } : {} } }))
    }

    /** `GET /fiscal/parametros/:clave/historial` (`fiscal.ver`): todas las versiones, por vigencia. */
    function historial(clave: string): Promise<Resultado<HistorialParametroFiscal>> {
        return resolver(api.GET('/api/v1/fiscal/parametros/{clave}/historial', { params: { path: { clave } } }))
    }

    /**
     * `POST /fiscal/parametros/:clave/valores` (`fiscal.editar_parametros`). 422
     * `parametro_no_editable`, `parametro_fuera_de_rango`, `vigencia_en_periodo_bloqueado`; 409
     * `vigencia_duplicada`; 403 `alcance_global_requerido` con `ambito: global`.
     */
    function agregarValor(clave: string, cuerpo: CuerpoValorParametro, idempotencia: string): Promise<Resultado<ValorParametroCreado>> {
        return resolver(api.POST('/api/v1/fiscal/parametros/{clave}/valores', {
            params: { path: { clave }, header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    /** `POST /fiscal/regimen` (`fiscal.cambiar_regimen`): 422 `regimen_fuera_de_plazo` fuera del 1 de enero. */
    function cambiarRegimen(cuerpo: CuerpoRegimen, idempotencia: string): Promise<Resultado<RegimenCambiado>> {
        return resolver(api.POST('/api/v1/fiscal/regimen', {
            params: { header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    return { listar, historial, agregarValor, cambiarRegimen }
}
