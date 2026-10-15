import type { Schema, paths } from '@argosisp/contracts'

export type Pago = Schema<'Pago'>
export type MetodoPago = Pago['metodo']
/** Cuerpo exacto de `POST /pagos` según `packages/contracts` (A3). */
export type DatosPago = paths['/api/v1/pagos']['post']['requestBody']['content']['application/json']

/** Pagos: registro (cobro) y consulta. */
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

    return { registrar, ver }
}
