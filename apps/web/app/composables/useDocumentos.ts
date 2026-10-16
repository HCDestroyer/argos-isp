import type { Schema } from '@argosisp/contracts'

export type PlantillaDocumento = Schema<'PlantillaDocumento'>
export type VariableDocumento = Schema<'VariableDocumento'>
export type TipoDocumento = PlantillaDocumento['tipo']

/**
 * Documentos PDF (A5): plantilla HTML con variables Mustache del aviso de cobro, su vista previa
 * y el PDF de cada factura. Los PDF llegan como `Blob` (`parseAs: 'blob'`); un error sigue
 * llegando como Problem RFC 9457.
 */
export function useDocumentos() {
    const api = useApi()

    /** `GET /documentos/plantillas/:tipo` (`documentos.ver`): HTML vigente, `version` y variables. */
    function plantilla(tipo: TipoDocumento = 'aviso_cobro'): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.GET('/api/v1/documentos/plantillas/{tipo}', { params: { path: { tipo } } }))
    }

    /** `PUT /documentos/plantillas/:tipo` (`documentos.editar`); 409 por `version`, 422 en `html`. */
    function guardarPlantilla(html: string, version: number, tipo: TipoDocumento = 'aviso_cobro'): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.PUT('/api/v1/documentos/plantillas/{tipo}', { params: { path: { tipo } }, body: { html, version } }))
    }

    /** `POST /documentos/plantillas/:tipo/vista-previa`: PDF con datos de ejemplo, sin guardar. */
    function vistaPrevia(html: string, tipo: TipoDocumento = 'aviso_cobro'): Promise<Resultado<Blob>> {
        return resolver(api.POST('/api/v1/documentos/plantillas/{tipo}/vista-previa', {
            params: { path: { tipo } },
            body: { html },
            parseAs: 'blob',
        }))
    }

    /** `GET /documentos/aviso-cobro/:facturaId` (`facturas.ver`): el PDF del aviso (o factura FEL). */
    function avisoCobro(facturaId: number): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/documentos/aviso-cobro/{facturaId}', {
            params: { path: { facturaId } },
            parseAs: 'blob',
        }))
    }

    return { plantilla, guardarPlantilla, vistaPrevia, avisoCobro }
}
