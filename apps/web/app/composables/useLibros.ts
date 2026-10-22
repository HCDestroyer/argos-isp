type Vistas = { [L in LibroEmitible]: (query: QueryVistaPrevia) => Promise<Resultado<ReporteLibro<L>>> }
type Borradores = { [L in LibroEmitible]: (query: QueryVistaPrevia, formato: FormatoVistaPrevia) => Promise<Resultado<Blob>> }

/**
 * Libros legales con folio (A3, fase 6 PR D): vista previa «Borrador sin folio» en JSON o como archivo
 * (CSV, XLSX o el PDF con la marca de agua), los folios de cada libro, la emisión oficial con
 * `Idempotency-Key`, su historial y el archivo guardado (409 `archivo_alterado`), y las habilitaciones
 * de folios. La empresa es la activa (`X-Empresa-Id`); las listas aceptan «Todas».
 */
export function useLibros() {
    const api = useApi()

    const vistas: Vistas = {
        diario: query => resolver(api.GET('/api/v1/libros/diario', { params: { query } })),
        mayor: query => resolver(api.GET('/api/v1/libros/mayor', { params: { query } })),
        ventas: query => resolver(api.GET('/api/v1/libros/ventas', { params: { query } })),
        compras: query => resolver(api.GET('/api/v1/libros/compras', { params: { query } })),
    }

    const borradores: Borradores = {
        diario: (query, formato) => resolver(api.GET('/api/v1/libros/diario', { params: { query: { ...query, formato } }, parseAs: 'blob' })),
        mayor: (query, formato) => resolver(api.GET('/api/v1/libros/mayor', { params: { query: { ...query, formato } }, parseAs: 'blob' })),
        ventas: (query, formato) => resolver(api.GET('/api/v1/libros/ventas', { params: { query: { ...query, formato } }, parseAs: 'blob' })),
        compras: (query, formato) => resolver(api.GET('/api/v1/libros/compras', { params: { query: { ...query, formato } }, parseAs: 'blob' })),
    }

    /** `GET /libros/<libro>` (`libros.ver`): columnas, filas (con `fila`) y totales de los movimientos. */
    function vistaPrevia<L extends LibroEmitible>(libro: L, query: QueryVistaPrevia): Promise<Resultado<ReporteLibro<L>>> {
        return vistas[libro](query)
    }

    /** El borrador como archivo: CSV, XLSX o PDF (`inline`, se puede embeber). */
    function borrador(libro: LibroEmitible, query: QueryVistaPrevia, formato: FormatoVistaPrevia): Promise<Resultado<Blob>> {
        return borradores[libro](query, formato)
    }

    /** `GET /libros/folios`: por libro, el siguiente folio y cuántos quedan habilitados. */
    function folios(empresaId?: number): Promise<Resultado<FoliosLibro[]>> {
        return resolver(api.GET('/api/v1/libros/folios', { params: { query: empresaId ? { empresa_id: empresaId } : {} } }))
    }

    /**
     * `POST /libros/:libro/emitir` (`libros.emitir`): 422 `periodo_sin_bloqueo` (`mes_abierto`,
     * `sin_bloqueo`), 422 `folios_agotados`, 409 `integridad_rota`.
     */
    function emitir(libro: LibroEmitible, cuerpo: CuerpoEmitir, claveIdempotencia: string): Promise<Resultado<EmisionLibro>> {
        return resolver(api.POST('/api/v1/libros/{libro}/emitir', {
            params: { path: { libro }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    function emisiones(filtros: FiltrosLibros = {}, cursor?: string): Promise<Resultado<Pagina<EmisionLibro>>> {
        const query: FiltrosLibros & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libros/emisiones', { params: { query } }))
    }

    function emision(id: number): Promise<Resultado<EmisionLibro>> {
        return resolver(api.GET('/api/v1/libros/emisiones/{id}', { params: { path: { id } } }))
    }

    /** El archivo tal como se guardó; 409 `archivo_alterado` si su SHA-256 ya no coincide. */
    function archivoEmision(id: number): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/libros/emisiones/{id}/archivo', { params: { path: { id } }, parseAs: 'blob' }))
    }

    function habilitaciones(filtros: FiltrosLibros = {}, cursor?: string): Promise<Resultado<Pagina<HabilitacionLibro>>> {
        const query: FiltrosLibros & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libros/habilitaciones', { params: { query } }))
    }

    /** `POST /libros/habilitaciones` (`libros.habilitar`): 422 `habilitacion_no_correlativa` en `folio_desde`. */
    function habilitar(cuerpo: CuerpoHabilitar, claveIdempotencia: string): Promise<Resultado<HabilitacionLibro>> {
        return resolver(api.POST('/api/v1/libros/habilitaciones', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    return { vistaPrevia, borrador, folios, emitir, emisiones, emision, archivoEmision, habilitaciones, habilitar }
}
