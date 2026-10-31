import type { Schema, paths } from '@argosisp/contracts'

export type BorradorCompra = Schema<'BorradorCompra'>
export type ExtraccionCompra = Schema<'ExtraccionCompra'>
export type PropuestaLineaCompra = NonNullable<BorradorCompra['propuesta']>['lineas'][number]
export type DatosBorradorCompra = paths['/api/v1/compras/borradores/{id}/editar']['post']['requestBody']['content']['application/json']['datos']
export type CuerpoConfirmarBorrador = paths['/api/v1/compras/borradores/{id}/confirmar']['post']['requestBody']['content']['application/json']
export type FiltrosBorradoresCompra = Omit<NonNullable<paths['/api/v1/compras/borradores']['get']['parameters']['query']>, 'cursor' | 'empresas'>

/**
 * Factura de compra desde un archivo (A3, `contratos/inventario.md` D.5): el XML FEL lo lee un parser,
 * el PDF o la imagen una IA configurable; queda un borrador que se corrige y se confirma (la compra la
 * registra `compras.registrar` con su asiento y su entrada al kardex) o se descarta. Nunca se crea una
 * compra sin la confirmación.
 */
export function useBorradoresCompra() {
    const api = useApi()
    const conClave = (clave: string) => ({ 'Idempotency-Key': clave })

    function listar(filtros: FiltrosBorradoresCompra = {}, cursor?: string): Promise<Resultado<Pagina<BorradorCompra>>> {
        return resolver(api.GET('/api/v1/compras/borradores', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    function ver(id: number): Promise<Resultado<BorradorCompra>> {
        return resolver(api.GET('/api/v1/compras/borradores/{id}', { params: { path: { id } } }))
    }

    /**
     * `POST /compras/borradores` (`compras.cargar_borrador`, multipart `archivo`): XML, PDF, JPG, PNG o
     * WebP hasta 10 MB; sin archivo, un borrador manual. 409 `archivo_duplicado` o `compra_duplicada`.
     */
    function cargar(archivo: File | null, clave: string): Promise<Resultado<BorradorCompra>> {
        return resolver(api.POST('/api/v1/compras/borradores', {
            params: { header: conClave(clave) },
            body: archivo ? { archivo: archivo.name } : {},
            bodySerializer: () => {
                const formulario = new FormData()
                if (archivo) {
                    formulario.append('archivo', archivo, archivo.name)
                }
                return formulario
            },
        }))
    }

    /** `POST /compras/borradores/:id/editar` (`compras.editar_borrador`): reemplaza `datos` y recalcula la propuesta. */
    function editar(borrador: Pick<BorradorCompra, 'id' | 'version'>, datos: DatosBorradorCompra, clave: string): Promise<Resultado<BorradorCompra>> {
        return resolver(api.POST('/api/v1/compras/borradores/{id}/editar', { params: { path: { id: borrador.id }, header: conClave(clave) }, body: { version: borrador.version, datos } }))
    }

    /** `POST /compras/borradores/:id/confirmar` (`compras.confirmar_borrador`): crea la compra (y lo que se pidió crear). */
    function confirmar(id: number, cuerpo: CuerpoConfirmarBorrador, clave: string): Promise<Resultado<BorradorCompra>> {
        return resolver(api.POST('/api/v1/compras/borradores/{id}/confirmar', { params: { path: { id }, header: conClave(clave) }, body: cuerpo }))
    }

    /** `POST /compras/borradores/:id/descartar` (`compras.descartar_borrador`), con motivo. */
    function descartar(borrador: Pick<BorradorCompra, 'id' | 'version'>, motivo: string, clave: string): Promise<Resultado<BorradorCompra>> {
        return resolver(api.POST('/api/v1/compras/borradores/{id}/descartar', { params: { path: { id: borrador.id }, header: conClave(clave) }, body: { version: borrador.version, motivo } }))
    }

    /** El archivo cargado (XML, PDF o imagen). */
    async function archivo(id: number): Promise<Resultado<Blob>> {
        const resultado = await resolver(api.GET('/api/v1/compras/borradores/{id}/archivo', { params: { path: { id } }, parseAs: 'blob' }))
        if (!resultado.ok) {
            return resultado
        }
        const datos: unknown = resultado.data
        return esBlob(datos) ? { ok: true, data: datos } : { ok: false, problema: { type: 'about:blank', title: 'El archivo no llegó', status: 500 } }
    }

    return { listar, ver, cargar, editar, confirmar, descartar, archivo }
}
