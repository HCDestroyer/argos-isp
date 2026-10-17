import type { Schema, paths } from '@argosisp/contracts'

export type FraseFiscal = Schema<'FraseFiscal'>
export type FrasesFiscales = Schema<'FrasesFiscales'>
export type CuerpoFrase = paths['/api/v1/fiscal/frases']['post']['requestBody']['content']['application/json']

/**
 * Frases del DTE. Las del régimen se calculan del régimen vigente (no se agregan ni se quitan
 * aquí); las manuales se agregan o retiran con vigencia (solo inserción).
 */
export function useFrasesFiscales() {
    const api = useApi()

    /** `GET /fiscal/frases?fecha=` (`fiscal.ver`): `vigentes` (régimen + manuales activas) e `historial`. */
    function listar(fecha?: string): Promise<Resultado<FrasesFiscales>> {
        return resolver(api.GET('/api/v1/fiscal/frases', { params: { query: fecha ? { fecha } : {} } }))
    }

    /** `POST /fiscal/frases` (`fiscal.configurar`): 422 `frase_del_regimen`, `frase_inactiva`; 409 `vigencia_duplicada`. */
    function agregar(cuerpo: CuerpoFrase, idempotencia: string): Promise<Resultado<FraseFiscal>> {
        return resolver(api.POST('/api/v1/fiscal/frases', {
            params: { header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    return { listar, agregar }
}
