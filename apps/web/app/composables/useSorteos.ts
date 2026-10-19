import type { Schema, paths } from '@argosisp/contracts'

export type SorteoDetalle = Schema<'SorteoDetalle'>
export type SorteoLista = Schema<'SorteoLealtad'>
export type RequisitoSorteo = Schema<'RequisitoSorteo'>
export type VerificacionSorteo = Schema<'VerificacionSorteo'>
export type EstadoSorteo = SorteoDetalle['estado']
export type GanadorSorteo = SorteoDetalle['ganadores'][number]
export type PremioSorteo = SorteoDetalle['premios'][number]
export type FiltrosSorteos = Omit<NonNullable<paths['/api/v1/lealtad/sorteos']['get']['parameters']['query']>, 'cursor'>
type CuerpoSorteo = paths['/api/v1/lealtad/sorteos']['post']['requestBody']['content']['application/json']
type CuerpoEdicion = paths['/api/v1/lealtad/sorteos/{id}']['put']['requestBody']['content']['application/json']
type CuerpoRequisito = paths['/api/v1/lealtad/sorteos/{id}/requisitos/{clave}']['post']['requestBody']['content']['application/json']
type CuerpoEjecutar = paths['/api/v1/lealtad/sorteos/{id}/ejecutar']['post']['requestBody']['content']['application/json']
type CuerpoEntrega = paths['/api/v1/lealtad/sorteos/{id}/ganadores/{ganadorId}/entregar']['post']['requestBody']['content']['application/json']

/**
 * Sorteos (A3, `contratos/lealtad.md` §7 y §15.3). Cada paso es su endpoint: publicar bases, abrir,
 * cerrar corte, ejecutar (con `valor_publico`), entregar y cancelar; todos con `Idempotency-Key`.
 * La verificación es pública (sin sesión) desde que se ejecuta.
 */
/** Un `Blob` (también el de otra implementación, como el de happy-dom en las pruebas). */
function esBlob(valor: unknown): valor is Blob {
    return valor instanceof Blob || (typeof valor === 'object' && valor !== null && typeof Reflect.get(valor, 'arrayBuffer') === 'function' && typeof Reflect.get(valor, 'type') === 'string')
}

export function useSorteos() {
    const api = useApi()
    const config = useRuntimeConfig()

    function listar(filtros: FiltrosSorteos = {}, cursor?: string): Promise<Resultado<Pagina<SorteoLista>>> {
        const query: FiltrosSorteos & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/lealtad/sorteos', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.GET('/api/v1/lealtad/sorteos/{id}', { params: { path: { id } } }))
    }

    /** `POST /lealtad/sorteos` (`sorteos.gestionar`): en borrador. */
    function crear(cuerpo: CuerpoSorteo, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** `PUT /lealtad/sorteos/:id` (`sorteos.gestionar`): solo en borrador; `premios` reemplaza la lista. */
    function editar(id: number, cuerpo: CuerpoEdicion): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.PUT('/api/v1/lealtad/sorteos/{id}', { params: { path: { id } }, body: cuerpo }))
    }

    /** `borrador → bases_publicadas` (`sorteos.publicar`): 422 `bases_incompletas` con el campo. */
    function publicarBases(id: number, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/publicar-bases', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `bases_publicadas → participacion_abierta` (`sorteos.publicar`): exige `bases_diaco`. */
    function abrir(id: number, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/abrir', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `participacion_abierta → corte_cerrado` (`sorteos.publicar`): 422 `corte_no_vencido`. */
    function cerrarCorte(id: number, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/cerrar-corte', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** Antes de ejecutar, con motivo (`sorteos.publicar`). */
    function cancelar(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/cancelar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /** `sorteos.marcar_requisito`: cumplido o no aplica con evidencia; responde el checklist vigente. */
    function marcarRequisito(id: number, clave: RequisitoSorteo['clave'], cuerpo: CuerpoRequisito, claveIdempotencia: string): Promise<Resultado<RequisitoSorteo[]>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/requisitos/{clave}', {
            params: { path: { id, clave }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** `corte_cerrado → ejecutado` (`sorteos.ejecutar`): 422 `requisito_pendiente` con la clave. */
    function ejecutar(id: number, cuerpo: CuerpoEjecutar, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/ejecutar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** `sorteos.entregar`: la contrapartida según el tipo del premio. */
    function entregar(id: number, ganadorId: number, cuerpo: CuerpoEntrega, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/ganadores/{ganadorId}/entregar', {
            params: { path: { id, ganadorId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** `sorteos.anular_entrega` (permiso `sorteos.entregar`, H22): deshace la entrega toda junta. */
    function anularEntrega(id: number, ganadorId: number, motivo: string, claveIdempotencia: string): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/ganadores/{ganadorId}/anular-entrega', {
            params: { path: { id, ganadorId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /** Anunciar o no el sorteo en el portal (`sorteos.gestionar`, hasta antes de ejecutar, con `version`). */
    function cambiarAvisoPortal(id: number, version: number, avisoPortal: boolean): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.PUT('/api/v1/lealtad/sorteos/{id}/aviso-portal', {
            params: { path: { id } },
            body: { version, aviso_portal: avisoPortal },
        }))
    }

    /**
     * Sube la imagen de un premio (`sorteos.gestionar`, solo en borrador), multipart `imagen`. El
     * OpenAPI tipa el archivo como `string` (binario): en el cuerpo va su nombre y `bodySerializer`
     * arma el `FormData` con el `File` real (como el logo de la empresa).
     */
    function subirImagenPremio(id: number, posicion: number, archivo: File): Promise<Resultado<SorteoDetalle>> {
        return resolver(api.POST('/api/v1/lealtad/sorteos/{id}/premios/{posicion}/imagen', {
            params: { path: { id, posicion: String(posicion) } },
            body: { imagen: archivo.name },
            bodySerializer: () => {
                const formulario = new FormData()
                formulario.append('imagen', archivo, archivo.name)
                return formulario
            },
        }))
    }

    /** La imagen de un premio como `Blob` (la ruta pide la sesión: no sirve en un `<img src>` directo). */
    async function imagenPremio(id: number, posicion: number): Promise<Resultado<Blob>> {
        const resultado = await resolver(api.GET('/api/v1/lealtad/sorteos/{id}/premios/{posicion}/imagen', {
            params: { path: { id, posicion: String(posicion) } },
            parseAs: 'blob',
        }))
        if (!resultado.ok) {
            return resultado
        }
        // El OpenAPI tipa `image/*` como `string`; con `parseAs: 'blob'` llega un `Blob`.
        const datos: unknown = resultado.data
        return esBlob(datos) ? { ok: true, data: datos } : { ok: false, problema: { type: 'about:blank', title: 'La imagen no llegó como archivo', status: 500 } }
    }

    /** Datos públicos para recalcular el resultado (404 antes de ejecutar). */
    function verificacion(id: number): Promise<Resultado<VerificacionSorteo>> {
        return resolver(api.GET('/api/v1/lealtad/sorteos/{id}/verificacion', { params: { path: { id } } }))
    }

    /** Enlace público (sin sesión) a la verificación o a las bases publicadas. */
    function urlPublica(id: number, recurso: 'verificacion' | 'bases'): string {
        return `${String(config.public.apiBase).replace(/\/$/, '')}/api/v1/lealtad/sorteos/${id}/${recurso}`
    }

    return { listar, ver, crear, editar, publicarBases, abrir, cerrarCorte, cancelar, marcarRequisito, ejecutar, entregar, anularEntrega, cambiarAvisoPortal, subirImagenPremio, imagenPremio, verificacion, urlPublica }
}
