import type { Schema, paths } from '@argosisp/contracts'

export type PlantillaDocumentoResumen = Schema<'PlantillaDocumentoResumen'>

/** Cuerpo de `POST /plantillas-documentos` (de `crearPlantillaDocumentoValidator`). */
export type NuevaPlantillaDocumento = paths['/api/v1/plantillas-documentos']['post']['requestBody']['content']['application/json']

/** Cuerpo de `PUT /plantillas-documentos/:id` (`html: null` vuelve a la de fábrica). */
export type CambiosPlantillaDocumento = paths['/api/v1/plantillas-documentos/{id}']['put']['requestBody']['content']['application/json']

/**
 * Plantillas de documentos guardadas (A5): varias por tipo (aviso de cobro, nota de crédito, recibo
 * de cobro), cada una con nombre y formato (carta o POS 80 mm), una predeterminada por tipo. Acciones
 * explícitas con su permiso (`documentos.crear`, `.editar`, `.predeterminar`, `.desactivar`,
 * `.activar`); las ediciones llevan `version` (409).
 */
export function usePlantillasDocumentos() {
    const api = useApi()

    /** `GET /plantillas-documentos` (`documentos.ver`): sin HTML, la predeterminada primero. */
    async function listar(filtro: { tipo?: TipoDocumento, activa?: boolean } = {}): Promise<Resultado<PlantillaDocumentoResumen[]>> {
        const resultado = await resolver(api.GET('/api/v1/plantillas-documentos', { params: { query: filtro } }))
        return resultado.ok ? { ok: true, data: resultado.data.data } : resultado
    }

    /** `GET /plantillas-documentos/:id` (`documentos.ver`): con HTML y variables. */
    function ver(id: number): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.GET('/api/v1/plantillas-documentos/{id}', { params: { path: { id } } }))
    }

    /** `POST /plantillas-documentos` (`documentos.crear`): de fábrica, copiando otra o con HTML. */
    function crear(cuerpo: NuevaPlantillaDocumento): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.POST('/api/v1/plantillas-documentos', { body: cuerpo }))
    }

    /** `PUT /plantillas-documentos/:id` (`documentos.editar`). */
    function editar(id: number, cambios: CambiosPlantillaDocumento): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.PUT('/api/v1/plantillas-documentos/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /plantillas-documentos/:id/predeterminar` (`documentos.predeterminar`). */
    function predeterminar(id: number, version: number): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.POST('/api/v1/plantillas-documentos/{id}/predeterminar', { params: { path: { id } }, body: { version } }))
    }

    /** `POST /plantillas-documentos/:id/desactivar` (`documentos.desactivar`); nunca la predeterminada. */
    function desactivar(id: number, version: number): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.POST('/api/v1/plantillas-documentos/{id}/desactivar', { params: { path: { id } }, body: { version } }))
    }

    /** `POST /plantillas-documentos/:id/activar` (`documentos.activar`). */
    function activar(id: number, version: number): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.POST('/api/v1/plantillas-documentos/{id}/activar', { params: { path: { id } }, body: { version } }))
    }

    return { listar, ver, crear, editar, predeterminar, desactivar, activar }
}
