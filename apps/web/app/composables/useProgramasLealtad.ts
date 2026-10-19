import type { Schema, paths } from '@argosisp/contracts'

export type ProgramaLealtad = Schema<'ProgramaLealtad'>
export type ProgramaLealtadEmpresa = Schema<'ProgramaLealtadEmpresa'>
export type DatosProgramaLealtad = paths['/api/v1/lealtad/programas']['post']['requestBody']['content']['application/json']
export type CambiosProgramaLealtad = paths['/api/v1/lealtad/programas/{id}']['put']['requestBody']['content']['application/json']

/**
 * Programa de lealtad de la empresa (A3, `contratos/lealtad.md` §11 y §15.1): uno por empresa. Se
 * crea inactivo, se edita con `version` y se activa o desactiva con su acción explícita.
 */
export function useProgramasLealtad() {
    const api = useApi()

    /** `GET /lealtad/programa` (`lealtad.ver`): el de la empresa activa, o `programa: null`. */
    function actual(): Promise<Resultado<ProgramaLealtadEmpresa>> {
        return resolver(api.GET('/api/v1/lealtad/programa'))
    }

    /** `POST /lealtad/programas` (`lealtad.configurar`); 422 `cuentas_lealtad_faltantes` con diferimiento sin cuentas. */
    function crear(datos: DatosProgramaLealtad, claveIdempotencia: string): Promise<Resultado<ProgramaLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/programas', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `PUT /lealtad/programas/:id` con `version` (409 si cambió). */
    function editar(id: number, cambios: CambiosProgramaLealtad): Promise<Resultado<ProgramaLealtad>> {
        return resolver(api.PUT('/api/v1/lealtad/programas/{id}', {
            params: { path: { id } },
            body: cambios,
        }))
    }

    /** `POST /lealtad/programas/:id/activar`: 409 `programa_ya_activo`, 422 `cuentas_lealtad_faltantes`. */
    function activar(id: number, claveIdempotencia: string): Promise<Resultado<ProgramaLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/programas/{id}/activar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `POST /lealtad/programas/:id/desactivar` con motivo: 409 `programa_inactivo_ya`. */
    function desactivar(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<ProgramaLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/programas/{id}/desactivar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    return { actual, crear, editar, activar, desactivar }
}
