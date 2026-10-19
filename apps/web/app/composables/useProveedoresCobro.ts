import type { Schema, paths } from '@argosisp/contracts'

export type ProveedorCobro = Schema<'ProveedorCobro'>
export type DatosProveedorCobro = paths['/api/v1/cobros/proveedores']['post']['requestBody']['content']['application/json']
export type CambiosProveedorCobro = paths['/api/v1/cobros/proveedores/{id}']['put']['requestBody']['content']['application/json']

/**
 * Proveedores de cobro por empresa (A3, fase 4 §10.3): pasarela, agente o débito con su subcuenta
 * puente `1.1.10.NN`, el banco donde liquida y la fecha de corte `desde` (no se edita). Desde esa
 * fecha sus pagos van al puente por el bruto y se liquidan con `POST /cobros/liquidaciones`.
 */
export function useProveedoresCobro() {
    const api = useApi()

    /** `GET /cobros/proveedores` (`bancos.ver`). */
    function listar(): Promise<Resultado<ProveedorCobro[]>> {
        return resolver(api.GET('/api/v1/cobros/proveedores'))
    }

    /** `POST /cobros/proveedores` (`cobros.configurar`); 409 `proveedor_cobro_duplicado`. */
    function crear(datos: DatosProveedorCobro, claveIdempotencia: string): Promise<Resultado<ProveedorCobro>> {
        return resolver(api.POST('/api/v1/cobros/proveedores', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `PUT /cobros/proveedores/:id` con `version` (409 si cambió); `desde` responde 422 `campo_solo_lectura`. */
    function editar(id: number, cambios: CambiosProveedorCobro, claveIdempotencia: string): Promise<Resultado<ProveedorCobro>> {
        return resolver(api.PUT('/api/v1/cobros/proveedores/{id}', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cambios,
        }))
    }

    return { listar, crear, editar }
}
