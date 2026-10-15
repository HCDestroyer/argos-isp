import type { Schema } from '@argosisp/contracts'

export type Zona = Schema<'Zona'>

/** Zonas (catálogo pequeño, sin paginación). */
export function useZonas() {
    const api = useApi()

    function listar(): Promise<Resultado<Zona[]>> {
        return resolver(api.GET('/api/v1/zonas'))
    }

    return { listar }
}
