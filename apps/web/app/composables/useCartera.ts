import type { Schema, paths } from '@argosisp/contracts'

export type ProvisionCartera = Schema<'ProvisionCartera'>
export type CastigoCartera = Schema<'CastigoCartera'>
export type DatosProvision = paths['/api/v1/cartera/provisionar']['post']['requestBody']['content']['application/json']
export type DatosCastigo = paths['/api/v1/cartera/castigos']['post']['requestBody']['content']['application/json']

/**
 * Cartera (A3, fase 4 §10.9): estimación de incobrables hasta el tope legal (`5.3.02 / 1.1.12`) y
 * castigo de facturas incobrables con motivo y evidencia de gestión de cobro.
 */
export function useCartera() {
    const api = useApi()

    function provisiones(cursor?: string): Promise<Resultado<Pagina<ProvisionCartera>>> {
        const query: { limit: number, cursor?: string } = { limit: 25 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cartera/provisiones', { params: { query } }))
    }

    /** `POST /cartera/provisionar` (`cartera.provisionar`): lo que falta hasta el tope, o una fila con 0. */
    function provisionar(datos: DatosProvision, claveIdempotencia: string): Promise<Resultado<ProvisionCartera>> {
        return resolver(api.POST('/api/v1/cartera/provisionar', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    function castigos(cursor?: string): Promise<Resultado<Pagina<CastigoCartera>>> {
        const query: { limit: number, cursor?: string } = { limit: 25 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cartera/castigos', { params: { query } }))
    }

    /** `POST /cartera/castigos` (`cartera.castigar`): un cliente y una empresa; 422 `castigo_sin_evidencia`. */
    function castigar(datos: DatosCastigo, claveIdempotencia: string): Promise<Resultado<CastigoCartera>> {
        return resolver(api.POST('/api/v1/cartera/castigos', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { provisiones, provisionar, castigos, castigar }
}
