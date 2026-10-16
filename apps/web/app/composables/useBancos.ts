import type { Schema } from '@argosisp/contracts'

export type Banco = Schema<'Banco'>

/** Catálogo de bancos de Guatemala (banco de origen de transferencias y ACH). Solo lectura. */
export function useBancos() {
    const api = useApi()

    /** `GET /bancos`: los activos, en el orden del catálogo ("Otro" al final). */
    function listar(): Promise<Resultado<Banco[]>> {
        return resolver(api.GET('/api/v1/bancos'))
    }

    return { listar }
}
