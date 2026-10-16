import type { Schema, paths } from '@argosisp/contracts'

export type CuentaBancaria = Schema<'CuentaBancaria'>
export type DatosCuentaBancaria = paths['/api/v1/cuentas-bancarias']['post']['requestBody']['content']['application/json']
export type CambiosCuentaBancaria = paths['/api/v1/cuentas-bancarias/{id}']['put']['requestBody']['content']['application/json']

/**
 * Cuentas bancarias propias: destino de depósitos, transferencias, ACH y remesas. Cada una tiene
 * su subcuenta de `1.1.02 Bancos` en el libro. No se borran: se desactivan (`activa: false`).
 */
export function useCuentasBancarias() {
    const api = useApi()

    function listar(filtros: { activa?: boolean } = {}): Promise<Resultado<CuentaBancaria[]>> {
        return resolver(api.GET('/api/v1/cuentas-bancarias', { params: { query: filtros } }))
    }

    function ver(id: number): Promise<Resultado<CuentaBancaria>> {
        return resolver(api.GET('/api/v1/cuentas-bancarias/{id}', { params: { path: { id } } }))
    }

    /** `POST /cuentas-bancarias` (`cuentas_bancarias.editar`); 409 si el número ya existe en ese banco. */
    function crear(datos: DatosCuentaBancaria): Promise<Resultado<CuentaBancaria>> {
        return resolver(api.POST('/api/v1/cuentas-bancarias', { body: datos }))
    }

    /** `PUT /cuentas-bancarias/:id` con la `version` leída; 409 si alguien más la cambió. */
    function editar(id: number, cambios: CambiosCuentaBancaria): Promise<Resultado<CuentaBancaria>> {
        return resolver(api.PUT('/api/v1/cuentas-bancarias/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, ver, crear, editar }
}
