import type { Schema, paths } from '@argosisp/contracts'

export type Deposito = Schema<'Deposito'>
export type Traslado = Schema<'Traslado'>
export type ResumenFondosEnTransito = Schema<'ResumenFondosEnTransito'>
export type DatosTraslado = paths['/api/v1/bancos/trasladar']['post']['requestBody']['content']['application/json']
export type EstadoTransito = Deposito['estado']
export type DatosReatribucion = paths['/api/v1/bancos/llegadas/reatribuir']['post']['requestBody']['content']['application/json']

/**
 * Fondos en tránsito `1.1.11` (A3, fase 4 §10.3): depósitos de caja y traslados entre bancos que
 * salieron y todavía no se concilian con la línea del extracto que los acredita. El depósito se
 * registra desde la caja (`useCajas().depositar`).
 */
export function useFondosEnTransito() {
    const api = useApi()

    /** `GET /bancos/fondos-en-transito` (`bancos.ver`): saldo de 1.1.11 vs lo pendiente, por empresa. */
    function resumen(): Promise<Resultado<ResumenFondosEnTransito[]>> {
        return resolver(api.GET('/api/v1/bancos/fondos-en-transito'))
    }

    function depositos(estado?: EstadoTransito, cursor?: string, limit = 25): Promise<Resultado<Pagina<Deposito>>> {
        const query: { limit: number, estado?: EstadoTransito, cursor?: string } = { limit }
        if (estado) {
            query.estado = estado
        }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bancos/depositos', { params: { query } }))
    }

    function traslados(estado?: EstadoTransito, cursor?: string, limit = 25): Promise<Resultado<Pagina<Traslado>>> {
        const query: { limit: number, estado?: EstadoTransito, cursor?: string } = { limit }
        if (estado) {
            query.estado = estado
        }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bancos/traslados', { params: { query } }))
    }

    /** `POST /bancos/trasladar` (`bancos.trasladar`): solo entre cuentas de la misma empresa; 409 `traslado_duplicado`. */
    function trasladar(datos: DatosTraslado, claveIdempotencia: string): Promise<Resultado<Traslado>> {
        return resolver(api.POST('/api/v1/bancos/trasladar', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /**
     * `POST /bancos/llegadas/reatribuir` (`bancos.reatribuir_llegada`): la llegada se atribuyó al
     * depósito o traslado equivocado. Deshace la conciliación de la línea, revierte esa llegada (el
     * documento vuelve a tránsito) y registra la del documento correcto con la misma línea.
     */
    function reatribuir(datos: DatosReatribucion, claveIdempotencia: string): Promise<Resultado<Conciliacion>> {
        return resolver(api.POST('/api/v1/bancos/llegadas/reatribuir', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { resumen, depositos, traslados, trasladar, reatribuir }
}
