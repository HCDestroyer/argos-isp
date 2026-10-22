import type { Schema, paths } from '@argosisp/contracts'

export type FeriadoFiscal = Schema<'FeriadoFiscal'>
export type FeriadosFiscales = Schema<'FeriadosFiscales'>
export type FeriadoAgregado = Schema<'FeriadoAgregado'>
export type CuerpoFeriado = paths['/api/v1/fiscal/feriados']['post']['requestBody']['content']['application/json']

/**
 * Feriados (días inhábiles para los plazos fiscales, A3 fase 7 PR A). Son globales y de solo
 * inserción: la fila vigente de cada fecha es la última; `activo: false` retira un feriado.
 */
export function useFeriadosFiscales() {
    const api = useApi()

    /** `GET /fiscal/feriados?anio=` (`fiscal.ver`): `vigentes` del año e `historial` de altas y retiros. */
    function listar(anio?: number): Promise<Resultado<FeriadosFiscales>> {
        return resolver(api.GET('/api/v1/fiscal/feriados', { params: { query: anio ? { anio } : {} } }))
    }

    /**
     * `POST /fiscal/feriados` (`fiscal.configurar`, alcance global: 403 `alcance_global_requerido`):
     * recalcula el calendario de todas las empresas. 409 `feriado_duplicado`, 422 `feriado_inexistente`.
     */
    function agregar(cuerpo: CuerpoFeriado, idempotencia: string): Promise<Resultado<FeriadoAgregado>> {
        return resolver(api.POST('/api/v1/fiscal/feriados', {
            params: { header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    return { listar, agregar }
}
