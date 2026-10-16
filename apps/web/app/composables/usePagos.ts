import type { Schema, paths } from '@argosisp/contracts'

export type Pago = Schema<'Pago'>
export type MetodoPago = Pago['metodo']
export type EstadoPago = Pago['estado']
/** Cuerpo exacto de `POST /pagos` según `packages/contracts` (A3). */
export type DatosPago = paths['/api/v1/pagos']['post']['requestBody']['content']['application/json']
export type FiltrosPagos = Omit<NonNullable<paths['/api/v1/pagos']['get']['parameters']['query']>, 'cursor'>

export const LIMITE_PAGOS = 25

/** Pagos: registro (cobro), consulta y anulación. */
export function usePagos() {
    const api = useApi()

    /**
     * `POST /pagos` con `Idempotency-Key`: una clave por formulario abierto, así un doble clic o
     * un reintento tras un corte de red no cobra dos veces. La API aplica a la factura más
     * antigua y, por evento, reactiva el servicio si ya no debe facturas vencidas.
     */
    function registrar(datos: DatosPago, claveIdempotencia: string): Promise<Resultado<Pago>> {
        return resolver(api.POST('/api/v1/pagos', {
            body: datos,
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    function ver(id: number): Promise<Resultado<Pago>> {
        return resolver(api.GET('/api/v1/pagos/{id}', { params: { path: { id } } }))
    }

    function listar(filtros: FiltrosPagos = {}, cursor?: string): Promise<Resultado<Pagina<Pago>>> {
        const query: FiltrosPagos & { cursor?: string } = { limit: LIMITE_PAGOS, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/pagos', { params: { query } }))
    }

    /**
     * `POST /pagos/:id/anular` con motivo (`pagos.anular`): la API revierte el asiento, devuelve
     * el saldo a las facturas y vuelve a evaluar los servicios.
     */
    function anular(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Pago>> {
        return resolver(api.POST('/api/v1/pagos/{id}/anular', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /**
     * Pagos que aplicaron a una factura. `GET /pagos` no filtra por factura (pedido a A3), así
     * que se leen los últimos 200 del cliente y se filtran por `aplicaciones[].factura_id`.
     */
    async function deFactura(clienteId: number, facturaId: number): Promise<Resultado<Pago[]>> {
        const resultado = await listar({ cliente_id: clienteId, limit: 200 })
        if (!resultado.ok) {
            return resultado
        }
        return { ok: true, data: resultado.data.data.filter(p => p.aplicaciones.some(a => a.factura_id === facturaId)) }
    }

    return { registrar, ver, listar, anular, deFactura }
}
