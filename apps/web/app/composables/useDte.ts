import type { Schema, paths } from '@argosisp/contracts'

export type SolicitudCertificacion = Schema<'SolicitudCertificacion'>
export type DteIntento = Schema<'DteIntento'>
export type LoteCertificacion = Schema<'LoteCertificacion'>
export type DatosLoteCertificacion = paths['/api/v1/fel/lotes']['post']['requestBody']['content']['application/json']
export type FiltrosDte = Omit<NonNullable<paths['/api/v1/dte']['get']['parameters']['query']>, 'cursor'>

export const LIMITE_DTE = 25

/**
 * DTE (certificaciones FEL; A3, fase 3): la cola consolidable, el detalle, el XML certificado y el
 * PDF del certificador, reintentar y pedir la certificación de una factura.
 */
export function useDte() {
    const api = useApi()

    /**
     * `GET /dte` (`fel.ver`): del más reciente al más antiguo, con `?empresas=todas` desde «Todas».
     * `estado` admite varios (se repite el parámetro); `desde`/`hasta` por fecha de emisión.
     */
    function listar(filtros: FiltrosDte = {}, cursor?: string): Promise<Resultado<Pagina<Dte>>> {
        const query: FiltrosDte & { cursor?: string } = { limit: LIMITE_DTE, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/dte', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Dte>> {
        return resolver(api.GET('/api/v1/dte/{id}', { params: { path: { id } } }))
    }

    /** El DTE vigente de un documento: el más reciente de `GET /dte?documento_tipo&documento_id`, o `null`. */
    async function deDocumento(tipo: Dte['documento_tipo'], documentoId: number): Promise<Resultado<Dte | null>> {
        const resultado = await listar({ documento_tipo: tipo, documento_id: documentoId, limit: 1 })
        return resultado.ok ? { ok: true, data: resultado.data.data[0] ?? null } : resultado
    }

    /** `GET /dte/:id/intentos` (`fel.ver`): la bitácora ante el certificador (`fiscal.dte_intentos`). */
    function intentos(id: number): Promise<Resultado<DteIntento[]>> {
        return resolver(api.GET('/api/v1/dte/{id}/intentos', { params: { path: { id } } }))
    }

    /** `GET /dte/:id/xml`: 404 mientras no esté certificado. */
    function xml(id: number): Promise<Resultado<string>> {
        return resolver(api.GET('/api/v1/dte/{id}/xml', { params: { path: { id } }, parseAs: 'text' }))
    }

    /** `GET /dte/:id/pdf`: solo si el certificador devolvió PDF (404 si no). */
    function pdf(id: number): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/dte/{id}/pdf', { params: { path: { id } }, parseAs: 'blob' }))
    }

    /**
     * `POST /dte/:id/reintentar` (`fel.certificar`): un rechazado crea un DTE nuevo con el receptor
     * releído (422 `receptor_requerido` si aún falta); un error temporal vuelve a la cola ya.
     * 409 `dte_no_reintentable`, `dte_en_proceso`, `factura_anulada`.
     */
    function reintentar(id: number, clave: string): Promise<Resultado<Dte>> {
        return resolver(api.POST('/api/v1/dte/{id}/reintentar', { params: { path: { id }, header: { 'Idempotency-Key': clave } } }))
    }

    /**
     * `POST /facturas/:id/certificar` (`fel.certificar`): crea el DTE pendiente (o en contingencia);
     * si ya tiene uno vigente lo devuelve. 422 `fel_no_configurada`, `receptor_requerido`,
     * `tipo_dte_no_permitido`; 409 `factura_anulada`.
     */
    function certificarFactura(facturaId: number, clave: string): Promise<Resultado<SolicitudCertificacion>> {
        return resolver(api.POST('/api/v1/facturas/{id}/certificar', { params: { path: { id: facturaId }, header: { 'Idempotency-Key': clave } } }))
    }

    /**
     * `POST /fel/lotes` (`fel.certificar`): pide la certificación de varias facturas (lista o rango de
     * emisión). Cada una se procesa como `certificarFactura`; las que no se pudieron van en `errores`.
     */
    function certificarLote(datos: DatosLoteCertificacion, clave: string): Promise<Resultado<LoteCertificacion>> {
        return resolver(api.POST('/api/v1/fel/lotes', { params: { header: { 'Idempotency-Key': clave } }, body: datos }))
    }

    return { listar, ver, intentos, deDocumento, xml, pdf, reintentar, certificarFactura, certificarLote }
}
