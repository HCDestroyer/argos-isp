import type { Schema, paths } from '@argosisp/contracts'

export type OrdenTraslado = Schema<'OrdenTraslado'>
export type OrdenTrasladoDetalle = Schema<'OrdenTrasladoDetalle'>
export type LineaOrdenTraslado = OrdenTrasladoDetalle['lineas'][number]
export type FiltrosOrdenesTraslado = Omit<NonNullable<paths['/api/v1/inventario/traslados']['get']['parameters']['query']>, 'cursor'>
export type CuerpoEnviarTraslado = paths['/api/v1/inventario/traslados/enviar']['post']['requestBody']['content']['application/json']
export type CuerpoRecibirTraslado = paths['/api/v1/inventario/traslados/{id}/recibir']['post']['requestBody']['content']['application/json']

/** Respuesta binaria tipada como `string` en el OpenAPI: con `parseAs: 'blob'` llega un `Blob`. */
async function archivoBlob(peticion: Promise<Resultado<unknown>>, que: string): Promise<Resultado<Blob>> {
    const resultado = await peticion
    if (!resultado.ok) {
        return resultado
    }
    const datos: unknown = resultado.data
    return esBlob(datos) ? { ok: true, data: datos } : { ok: false, problema: { type: 'about:blank', title: `${que} no llegó como archivo`, status: 500 } }
}

/**
 * Órdenes de traslado (A3, `contratos/inventario.md` D.1): enviar (`inventario.crear_traslado`),
 * recibir (`inventario.recibir_traslado`, con firma digital, en papel o por aceptación simple),
 * cancelar con motivo, adjuntar el papel firmado y el PDF imprimible. Todo con `Idempotency-Key`.
 */
export function useOrdenesTraslado() {
    const api = useApi()
    const conClave = (clave: string) => ({ 'Idempotency-Key': clave })

    /** `GET /inventario/traslados` (`inventario.ver`): filtros `estado`, `bodega_id`, `numero`. */
    function listar(filtros: FiltrosOrdenesTraslado = {}, cursor?: string): Promise<Resultado<Pagina<OrdenTraslado>>> {
        return resolver(api.GET('/api/v1/inventario/traslados', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    function ver(id: number): Promise<Resultado<OrdenTrasladoDetalle>> {
        return resolver(api.GET('/api/v1/inventario/traslados/{id}', { params: { path: { id } } }))
    }

    /** `POST /inventario/traslados/enviar`: todo o nada (409 `existencia_insuficiente`, `unidad_*`). */
    function enviar(cuerpo: CuerpoEnviarTraslado, clave: string): Promise<Resultado<OrdenTrasladoDetalle>> {
        return resolver(api.POST('/api/v1/inventario/traslados/enviar', { params: { header: conClave(clave) }, body: cuerpo }))
    }

    /** `POST /inventario/traslados/:id/recibir`: un 2xx es definitivo (otra recepción → 409 `traslado_ya_recibido`). */
    function recibir(id: number, cuerpo: CuerpoRecibirTraslado, clave: string): Promise<Resultado<OrdenTrasladoDetalle>> {
        return resolver(api.POST('/api/v1/inventario/traslados/{id}/recibir', { params: { path: { id }, header: conClave(clave) }, body: cuerpo }))
    }

    /** `POST /inventario/traslados/:id/cancelar`: todo vuelve al origen. */
    function cancelar(orden: Pick<OrdenTraslado, 'id' | 'version'>, motivo: string, clave: string): Promise<Resultado<OrdenTrasladoDetalle>> {
        return resolver(api.POST('/api/v1/inventario/traslados/{id}/cancelar', { params: { path: { id: orden.id }, header: conClave(clave) }, body: { motivo, version: orden.version } }))
    }

    /**
     * `POST /inventario/traslados/:id/documento` (multipart `archivo`): el papel firmado de una orden
     * recibida con `firma_papel`, una sola vez (409 `documento_registrado`). JPG, PNG, WebP o PDF ≤ 5 MB.
     */
    function adjuntarDocumento(id: number, archivo: File, nota: string | null, clave: string): Promise<Resultado<OrdenTrasladoDetalle>> {
        return resolver(api.POST('/api/v1/inventario/traslados/{id}/documento', {
            params: { path: { id }, header: conClave(clave) },
            body: { archivo: archivo.name, nota },
            bodySerializer: () => {
                const formulario = new FormData()
                formulario.append('archivo', archivo, archivo.name)
                if (nota) {
                    formulario.append('nota', nota)
                }
                return formulario
            },
        }))
    }

    /** El PDF imprimible de la orden (sin costos). */
    function pdf(id: number): Promise<Resultado<Blob>> {
        return archivoBlob(resolver(api.GET('/api/v1/inventario/traslados/{id}/pdf', { params: { path: { id } }, parseAs: 'blob' })), 'El PDF')
    }

    /** La firma digital guardada (PNG). */
    function firma(id: number): Promise<Resultado<Blob>> {
        return archivoBlob(resolver(api.GET('/api/v1/inventario/traslados/{id}/firma', { params: { path: { id } }, parseAs: 'blob' })), 'La firma')
    }

    /** El papel firmado adjunto. */
    function documento(id: number): Promise<Resultado<Blob>> {
        return archivoBlob(resolver(api.GET('/api/v1/inventario/traslados/{id}/documento', { params: { path: { id } }, parseAs: 'blob' })), 'El documento')
    }

    return { listar, ver, enviar, recibir, cancelar, adjuntarDocumento, pdf, firma, documento }
}
