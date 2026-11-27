import type { Schema, paths } from '@argosisp/contracts'

export type CustodiaEfectivo = Schema<'CustodiaEfectivo'>
export type PersonaCustodia = CustodiaEfectivo['personas'][number]
export type EntregaCaja = Schema<'EntregaCaja'>
export type AjustesCajas = Schema<'AjustesCajas'>
export type FiltrosEntregas = Omit<NonNullable<paths['/api/v1/cajas/entregas']['get']['parameters']['query']>, 'cursor'>
export type DatosRecibirEntrega = paths['/api/v1/cajas/entregas/{id}/recibir']['post']['requestBody']['content']['application/json']
export type DatosDepositoCustodia = paths['/api/v1/custodia/depositar']['post']['requestBody']['content']['application/json']

/**
 * Custodia del efectivo (B1 del plan de contabilidad, §5.7; tablero PlanCajas): el efectivo que
 * salió de una caja de cobros con una entrega y aún no llega al banco, siempre a nombre de una
 * persona. Entregas («Recibí» o «No lo recibí») y depósitos desde la custodia.
 */
export function useCustodia() {
    const api = useApi()

    /** `GET /cajas/custodia` (`cajas.ver`; sin `cajas.ver_custodia`, solo la tuya). */
    function resumen(): Promise<Resultado<CustodiaEfectivo>> {
        return resolver(api.GET('/api/v1/cajas/custodia'))
    }

    /** `GET /cajas/entregas`: por estado, caja o quien recibe; las tuyas sin `cajas.ver_custodia`. */
    function entregas(filtros: FiltrosEntregas = {}, cursor?: string): Promise<Resultado<Pagina<EntregaCaja>>> {
        const query: FiltrosEntregas & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cajas/entregas', { params: { query } }))
    }

    /**
     * `POST /cajas/entregas/:id/recibir` (`cajas.recibir_entrega`): con lo contado distinto de lo
     * entregado, el motivo es obligatorio y la diferencia queda a cargo de quien entregó.
     */
    function recibir(id: number, datos: DatosRecibirEntrega, clave: string): Promise<Resultado<EntregaCaja>> {
        return resolver(api.POST('/api/v1/cajas/entregas/{id}/recibir', {
            params: { path: { id }, header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    /** `POST /cajas/entregas/:id/rechazar` (`cajas.rechazar_entrega`): «No lo recibí», con motivo. */
    function rechazar(id: number, motivo: string, clave: string): Promise<Resultado<EntregaCaja>> {
        return resolver(api.POST('/api/v1/cajas/entregas/{id}/rechazar', {
            params: { path: { id }, header: { 'Idempotency-Key': clave } },
            body: { motivo },
        }))
    }

    /**
     * `POST /custodia/depositar` (`cajas.depositar`): lo que tienes en custodia va a fondos en
     * tránsito con su boleta. 422 `deposito_excede_custodia`, 409 `deposito_duplicado`.
     */
    function depositar(datos: DatosDepositoCustodia, clave: string): Promise<Resultado<Schema<'Deposito'>>> {
        return resolver(api.POST('/api/v1/custodia/depositar', {
            params: { header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    /** `GET /cajas/ajustes` (`cajas.ver`): fondo de cambio, plazo y tope de custodia, fondo de caja chica. */
    function ajustes(): Promise<Resultado<AjustesCajas>> {
        return resolver(api.GET('/api/v1/cajas/ajustes'))
    }

    return { resumen, entregas, recibir, rechazar, depositar, ajustes }
}
