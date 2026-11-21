import type { Schema } from '@argosisp/contracts'

export type PlantillaDocumento = Schema<'PlantillaDocumento'>
export type VariableDocumento = Schema<'VariableDocumento'>
export type TipoDocumento = PlantillaDocumento['tipo']
export type FormatoDocumento = PlantillaDocumento['formato']
export type PlantillaDocumentoFabrica = Schema<'PlantillaDocumentoFabrica'>

/**
 * Documentos PDF (A5): la plantilla predeterminada de cada tipo (rutas por tipo, las de siempre), su
 * vista previa y el PDF de cada documento. Los PDF del panel aceptan `plantillaId` para imprimir con
 * otra plantilla activa del tipo (p. ej. POS 80 mm); sin él, la predeterminada. Los PDF llegan como
 * `Blob` (`parseAs: 'blob'`); un error sigue llegando como Problem RFC 9457. Las plantillas
 * guardadas (crear, editar, predeterminar…) están en `usePlantillasDocumentos`.
 */
export function useDocumentos() {
    const api = useApi()

    /** `GET /documentos/plantillas/:tipo` (`documentos.ver`): la predeterminada con su HTML y variables. */
    function plantilla(tipo: TipoDocumento = 'aviso_cobro'): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.GET('/api/v1/documentos/plantillas/{tipo}', { params: { path: { tipo } } }))
    }

    /** `PUT /documentos/plantillas/:tipo` (`documentos.editar`): HTML de la predeterminada; 409 por `version`. */
    function guardarPlantilla(html: string, version: number, tipo: TipoDocumento = 'aviso_cobro'): Promise<Resultado<PlantillaDocumento>> {
        return resolver(api.PUT('/api/v1/documentos/plantillas/{tipo}', { params: { path: { tipo } }, body: { html, version } }))
    }

    /** `POST /documentos/plantillas/:tipo/vista-previa`: PDF con datos de ejemplo en el formato, sin guardar. */
    function vistaPrevia(html: string, tipo: TipoDocumento = 'aviso_cobro', formato: FormatoDocumento = 'carta'): Promise<Resultado<Blob>> {
        return resolver(api.POST('/api/v1/documentos/plantillas/{tipo}/vista-previa', {
            params: { path: { tipo } },
            body: { html, formato },
            parseAs: 'blob',
        }))
    }

    /**
     * `GET /documentos/plantillas/:tipo/fabrica?formato=` (`documentos.ver`): la plantilla de esta
     * versión de ArgosIsp en ese formato (con el bloque FEL), aunque la empresa haya guardado otra.
     */
    function fabrica(tipo: TipoDocumento = 'aviso_cobro', formato: FormatoDocumento = 'carta'): Promise<Resultado<PlantillaDocumentoFabrica>> {
        return resolver(api.GET('/api/v1/documentos/plantillas/{tipo}/fabrica', { params: { path: { tipo }, query: { formato } } }))
    }

    /** `GET /documentos/aviso-cobro/:facturaId` (`facturas.ver`): el PDF del aviso (o factura FEL). */
    function avisoCobro(facturaId: number, plantillaId?: number | null): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/documentos/aviso-cobro/{facturaId}', {
            params: { path: { facturaId }, query: plantillaId ? { plantilla_id: plantillaId } : {} },
            parseAs: 'blob',
        }))
    }

    /** `GET /documentos/nota-credito/:notaId` (`facturas.ver`): el PDF de la nota (NCRE si la tiene). */
    function notaCredito(notaId: number, plantillaId?: number | null): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/documentos/nota-credito/{notaId}', {
            params: { path: { notaId }, query: plantillaId ? { plantilla_id: plantillaId } : {} },
            parseAs: 'blob',
        }))
    }

    /** `GET /documentos/recibo-cobro/:cobroId` (`pagos.ver`): el recibo de un cobro de caja. */
    function reciboCobro(cobroId: number, plantillaId?: number | null): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/documentos/recibo-cobro/{cobroId}', {
            params: { path: { cobroId }, query: plantillaId ? { plantilla_id: plantillaId } : {} },
            parseAs: 'blob',
        }))
    }

    return { plantilla, guardarPlantilla, vistaPrevia, avisoCobro, fabrica, notaCredito, reciboCobro }
}
