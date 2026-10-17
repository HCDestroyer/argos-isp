import type { Schema, paths } from '@argosisp/contracts'

export type Zona = Schema<'Zona'>

export type CambiosZona = paths['/api/v1/zonas/{id}']['put']['requestBody']['content']['application/json']

/** Zonas (catálogo pequeño, sin paginación) y su empresa sugerida (multiempresa). */
export function useZonas() {
    const api = useApi()

    function listar(): Promise<Resultado<Zona[]>> {
        return resolver(api.GET('/api/v1/zonas'))
    }

    /** `PUT /zonas/:id` (`zonas.editar`) con la `version` leída; `empresa_sugerida_id: null` la quita. */
    function editar(id: number, cambios: CambiosZona): Promise<Resultado<Zona>> {
        return resolver(api.PUT('/api/v1/zonas/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, editar }
}
