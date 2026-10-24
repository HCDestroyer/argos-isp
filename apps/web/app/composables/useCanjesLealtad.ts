import type { Schema, paths } from '@argosisp/contracts'

export type CanjeLealtad = Schema<'CanjeLealtad'>
export type DatosCanjeLealtad = paths['/api/v1/lealtad/canjes']['post']['requestBody']['content']['application/json']
export type FiltrosCanjesLealtad = Omit<NonNullable<paths['/api/v1/lealtad/canjes']['get']['parameters']['query']>, 'cursor'>

/** Canjes de puntos por premios (A3): lista, canjear desde el panel y revertir un reservado. */
export function useCanjesLealtad() {
    const api = useApi()

    function listar(filtros: FiltrosCanjesLealtad = {}, cursor?: string): Promise<Resultado<Pagina<CanjeLealtad>>> {
        const query: FiltrosCanjesLealtad & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/lealtad/canjes', { params: { query } }))
    }

    /**
     * `POST /lealtad/canjes` (`lealtad.canjear`): descuenta los puntos y reserva o aplica el premio.
     * 422 `saldo_insuficiente`, `sin_existencias`, `premio_inactivo`; 409 `canje_pendiente`.
     */
    function crear(datos: DatosCanjeLealtad, claveIdempotencia: string): Promise<Resultado<CanjeLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/canjes', { params: { header: { 'Idempotency-Key': claveIdempotencia } }, body: datos }))
    }

    /** `POST /lealtad/canjes/:id/revertir` (`lealtad.revertir_canje`): solo un reservado; devuelve los puntos. */
    function revertir(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<CanjeLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/canjes/{id}/revertir', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    return { listar, crear, revertir }
}
