import type { Schema, paths } from '@argosisp/contracts'

export type ReglaConciliacion = Schema<'ReglaConciliacion'>
export type DatosReglaConciliacion = paths['/api/v1/bancos/reglas']['post']['requestBody']['content']['application/json']
export type CambiosReglaConciliacion = paths['/api/v1/bancos/reglas/{id}']['put']['requestBody']['content']['application/json']

/**
 * Reglas de conciliación (A3, fase 4 §10.3): texto que contiene o regex, rango de monto con signo y
 * cuenta opcional; acción `contrapartida` (registra y concilia) o `cliente` (el pago bancario con
 * esa referencia y ese monto). Configuración con `version` y `audit.cambios`.
 */
export function useReglasConciliacion() {
    const api = useApi()

    function listar(): Promise<Resultado<ReglaConciliacion[]>> {
        return resolver(api.GET('/api/v1/bancos/reglas'))
    }

    function crear(datos: DatosReglaConciliacion, claveIdempotencia: string): Promise<Resultado<ReglaConciliacion>> {
        return resolver(api.POST('/api/v1/bancos/reglas', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `PUT /bancos/reglas/:id` con `version` (409 si otra persona la cambió). */
    function editar(id: number, cambios: CambiosReglaConciliacion, claveIdempotencia: string): Promise<Resultado<ReglaConciliacion>> {
        return resolver(api.PUT('/api/v1/bancos/reglas/{id}', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: cambios,
        }))
    }

    return { listar, crear, editar }
}
