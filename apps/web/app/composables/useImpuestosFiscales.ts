import type { Schema, paths } from '@argosisp/contracts'

export type ImpuestoFiscal = Schema<'ImpuestoFiscal'>
export type HistorialImpuestoFiscal = Schema<'HistorialImpuestoFiscal'>
export type CuerpoVersionImpuesto = paths['/api/v1/fiscal/impuestos/{codigo}/versiones']['post']['requestBody']['content']['application/json']

/**
 * Impuestos con vigencia (`fiscal.impuestos`, contrato §10.2): IVA, pequeño contribuyente y
 * retenciones. La tasa va siempre en positivo y el `signo` (-1 en retenciones) es del impuesto.
 */
export function useImpuestosFiscales() {
    const api = useApi()

    /** `GET /fiscal/impuestos?fecha=` (`fiscal.ver`): la versión vigente de cada código. */
    function listar(fecha?: string): Promise<Resultado<Schema<'ImpuestosFiscales'>>> {
        return resolver(api.GET('/api/v1/fiscal/impuestos', { params: { query: fecha ? { fecha } : {} } }))
    }

    /** `GET /fiscal/impuestos/:codigo/historial` (`fiscal.ver`). */
    function historial(codigo: string): Promise<Resultado<HistorialImpuestoFiscal>> {
        return resolver(api.GET('/api/v1/fiscal/impuestos/{codigo}/historial', { params: { path: { codigo } } }))
    }

    /** `POST /fiscal/impuestos/:codigo/versiones` (`fiscal.editar_parametros`): otra tasa o inactivo desde una fecha. */
    function agregarVersion(codigo: string, cuerpo: CuerpoVersionImpuesto, idempotencia: string): Promise<Resultado<ImpuestoFiscal>> {
        return resolver(api.POST('/api/v1/fiscal/impuestos/{codigo}/versiones', {
            params: { path: { codigo }, header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    return { listar, historial, agregarVersion }
}
