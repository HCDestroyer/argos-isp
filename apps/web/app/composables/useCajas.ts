import type { Schema } from '@argosisp/contracts'

export type Caja = Schema<'Caja'>

/** Cajas y sus turnos. */
export function useCajas() {
    const api = useApi()

    function listar(): Promise<Resultado<Caja[]>> {
        return resolver(api.GET('/api/v1/cajas'))
    }

    return { listar }
}
