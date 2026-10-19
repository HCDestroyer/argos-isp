import type { Schema, paths } from '@argosisp/contracts'

export type EstablecimientoFiscal = Schema<'EstablecimientoFiscal'>
export type DatosEstablecimiento = paths['/api/v1/fiscal/establecimientos']['post']['requestBody']['content']['application/json']
export type CambiosEstablecimiento = paths['/api/v1/fiscal/establecimientos/{id}']['put']['requestBody']['content']['application/json']

/**
 * Establecimientos de la SAT de la empresa activa. Uno es el por defecto (con él se emite); el
 * código SAT no se edita y no se borran: se desactivan.
 */
export function useEstablecimientosFiscales() {
    const api = useApi()

    function listar(): Promise<Resultado<EstablecimientoFiscal[]>> {
        return resolver(api.GET('/api/v1/fiscal/establecimientos'))
    }

    function ver(id: number): Promise<Resultado<EstablecimientoFiscal>> {
        return resolver(api.GET('/api/v1/fiscal/establecimientos/{id}', { params: { path: { id } } }))
    }

    /** `POST /fiscal/establecimientos` (`fiscal.configurar`); 409 `establecimiento_duplicado`. */
    function crear(datos: DatosEstablecimiento, idempotencia: string): Promise<Resultado<EstablecimientoFiscal>> {
        return resolver(api.POST('/api/v1/fiscal/establecimientos', {
            params: { header: { 'Idempotency-Key': idempotencia } },
            body: datos,
        }))
    }

    /** `PUT /fiscal/establecimientos/:id` con `version` (409); 422 `establecimiento_por_defecto`. */
    function editar(id: number, cambios: CambiosEstablecimiento): Promise<Resultado<EstablecimientoFiscal>> {
        return resolver(api.PUT('/api/v1/fiscal/establecimientos/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, ver, crear, editar }
}
