import type { Schema, paths } from '@argosisp/contracts'

export type PremioLealtad = Schema<'PremioLealtad'>
export type DatosPremioLealtad = paths['/api/v1/lealtad/premios']['post']['requestBody']['content']['application/json']
export type CambiosPremioLealtad = paths['/api/v1/lealtad/premios/{id}']['put']['requestBody']['content']['application/json']
export type FiltrosPremiosLealtad = Omit<NonNullable<paths['/api/v1/lealtad/premios']['get']['parameters']['query']>, 'cursor'>

/**
 * Catálogo de premios de lealtad (A3, fase 2; `lealtad.ver`): lista, alta y edición
 * (`lealtad.configurar`). El sorteo lo lee para elegir el descuento o mes gratis de un premio.
 */
export function usePremiosLealtad() {
    const api = useApi()

    function listar(filtros: FiltrosPremiosLealtad = {}, cursor?: string): Promise<Resultado<Pagina<PremioLealtad>>> {
        const query: FiltrosPremiosLealtad & { cursor?: string } = { limit: 100, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/lealtad/premios', { params: { query } }))
    }

    /** `POST /lealtad/premios` (`lealtad.configurar`) con `Idempotency-Key`; 422 por campo del tipo. */
    function crear(datos: DatosPremioLealtad, claveIdempotencia: string): Promise<Resultado<PremioLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/premios', { params: { header: { 'Idempotency-Key': claveIdempotencia } }, body: datos }))
    }

    /** `PUT /lealtad/premios/:id` (`lealtad.configurar`) con la `version` leída; desactivar es `activo: false`. */
    function editar(id: number, cambios: CambiosPremioLealtad): Promise<Resultado<PremioLealtad>> {
        return resolver(api.PUT('/api/v1/lealtad/premios/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, crear, editar }
}
