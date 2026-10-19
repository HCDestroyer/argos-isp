import type { Schema, paths } from '@argosisp/contracts'

export type ReglaLealtad = Schema<'ReglaLealtad'>
export type TipoReglaLealtad = ReglaLealtad['tipo']
export type DatosReglaLealtad = paths['/api/v1/lealtad/reglas']['post']['requestBody']['content']['application/json']
export type CambiosReglaLealtad = paths['/api/v1/lealtad/reglas/{id}']['put']['requestBody']['content']['application/json']
export type FiltrosReglasLealtad = Omit<NonNullable<paths['/api/v1/lealtad/reglas']['get']['parameters']['query']>, 'cursor'>

/**
 * Reglas para ganar puntos (A3, `contratos/lealtad.md` §4): `pago_a_tiempo`, `antiguedad`,
 * `referido` y `pago_adelantado`, cada una con sus `condiciones`. El tipo no se edita.
 */
export function useReglasLealtad() {
    const api = useApi()

    function listar(filtros: FiltrosReglasLealtad = {}, cursor?: string): Promise<Resultado<Pagina<ReglaLealtad>>> {
        const query: FiltrosReglasLealtad & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/lealtad/reglas', { params: { query } }))
    }

    /** `POST /lealtad/reglas` (`lealtad.configurar`); 422 `recompensa_no_disponible` fuera de `puntos`. */
    function crear(datos: DatosReglaLealtad, claveIdempotencia: string): Promise<Resultado<ReglaLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/reglas', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `PUT /lealtad/reglas/:id` con `version`; `condiciones` se validan con el esquema de su tipo. */
    function editar(id: number, cambios: CambiosReglaLealtad): Promise<Resultado<ReglaLealtad>> {
        return resolver(api.PUT('/api/v1/lealtad/reglas/{id}', {
            params: { path: { id } },
            body: cambios,
        }))
    }

    return { listar, crear, editar }
}
