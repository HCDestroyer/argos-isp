import type { Schema, paths } from '@argosisp/contracts'

export type Anuncio = Schema<'Anuncio'>
export type MetricasAnuncio = Schema<'MetricasAnuncio'>
export type FiltrosAnuncios = Omit<NonNullable<paths['/api/v1/anuncios']['get']['parameters']['query']>, 'cursor'>
export type DatosAnuncio = paths['/api/v1/anuncios']['post']['requestBody']['content']['application/json']
export type CambiosAnuncio = paths['/api/v1/anuncios/{id}']['put']['requestBody']['content']['application/json']

/**
 * Anuncios del portal (A5, `contratos/anuncios.md` §2): promociones de la empresa activa en el
 * inicio del portal y la página de corte. Se crean en borrador, se editan con `version` y
 * cambian de estado solo por acción (publicar, archivar).
 */
export function useAnuncios() {
    const api = useApi()

    function listar(filtros: FiltrosAnuncios = {}, cursor?: string): Promise<Resultado<Pagina<Anuncio>>> {
        const query: FiltrosAnuncios & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/anuncios', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Anuncio>> {
        return resolver(api.GET('/api/v1/anuncios/{id}', { params: { path: { id } } }))
    }

    /** `POST /anuncios` (`anuncios.administrar`): nace en borrador; 422 `empresa_requerida` sin empresa activa. */
    function crear(datos: DatosAnuncio): Promise<Resultado<Anuncio>> {
        return resolver(api.POST('/api/v1/anuncios', { body: datos }))
    }

    /**
     * `PUT /anuncios/:id` con `version`: solo los campos enviados; `inicio` y `fin` en `null` los
     * borran. Archivado: 422 `anuncio_archivado`.
     */
    function editar(id: number, cambios: CambiosAnuncio): Promise<Resultado<Anuncio>> {
        return resolver(api.PUT('/api/v1/anuncios/{id}', { params: { path: { id } }, body: cambios }))
    }

    /**
     * `POST /anuncios/:id/imagen` (multipart): PNG, JPEG o WebP hasta 1 MB con `alt` (obligatorio si
     * el anuncio aún no tiene); sin archivo, la quita. El OpenAPI tipa el archivo como `string`
     * (binario): `bodySerializer` arma el `FormData` con el `File` real.
     */
    function cambiarImagen(id: number, version: number, archivo: File | null, alt: string): Promise<Resultado<Anuncio>> {
        return resolver(api.POST('/api/v1/anuncios/{id}/imagen', {
            params: { path: { id } },
            body: archivo ? { version, imagen: archivo.name, alt } : { version, quitar: true },
            bodySerializer: () => {
                const formulario = new FormData()
                formulario.append('version', String(version))
                if (archivo) {
                    if (alt) {
                        formulario.append('alt', alt)
                    }
                    formulario.append('imagen', archivo, archivo.name)
                }
                else {
                    formulario.append('quitar', 'true')
                }
                return formulario
            },
        }))
    }

    /** `GET /anuncios/:id/imagen`: va con la sesión de la API (otro origen), así que llega como `Blob`. */
    function imagen(id: number): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/anuncios/{id}/imagen', { params: { path: { id } }, parseAs: 'blob' }))
    }

    /** `POST /anuncios/:id/publicar`: desde borrador o archivado; con `fin` pasado, 422 `anuncio_vencido`. */
    function publicar(id: number, version: number): Promise<Resultado<Anuncio>> {
        return resolver(api.POST('/api/v1/anuncios/{id}/publicar', { params: { path: { id } }, body: { version } }))
    }

    /** `POST /anuncios/:id/archivar`: desde borrador o publicado; deja de verse en el portal. */
    function archivar(id: number, version: number): Promise<Resultado<Anuncio>> {
        return resolver(api.POST('/api/v1/anuncios/{id}/archivar', { params: { path: { id } }, body: { version } }))
    }

    /** `GET /anuncios/:id/metricas`: vistas y clics (visitantes distintos), por lugar y por día. */
    function metricas(id: number): Promise<Resultado<MetricasAnuncio>> {
        return resolver(api.GET('/api/v1/anuncios/{id}/metricas', { params: { path: { id } } }))
    }

    return { listar, ver, crear, editar, cambiarImagen, imagen, publicar, archivar, metricas }
}
