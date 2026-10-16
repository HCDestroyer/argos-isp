import type { Schema, paths } from '@argosisp/contracts'

export type Egreso = Schema<'Egreso'>
export type CategoriaEgresoApi = Schema<'CategoriaEgreso'>
export type FiltrosEgresos = Omit<NonNullable<paths['/api/v1/egresos']['get']['parameters']['query']>, 'cursor'>

/**
 * Egresos (A3, `egresos.*`): gastos pagados por caja, banco o una cuenta bancaria propia. Cada
 * uno genera su asiento; anular deja un asiento de reverso (nunca se borra).
 */
export function useEgresos() {
    const api = useApi()

    /** `GET /egresos/categorias`: clave, nombre y cuenta de gasto. */
    function categorias(): Promise<Resultado<CategoriaEgresoApi[]>> {
        return resolver(api.GET('/api/v1/egresos/categorias'))
    }

    function listar(filtros: FiltrosEgresos = {}, cursor?: string): Promise<Resultado<Pagina<Egreso>>> {
        const query: FiltrosEgresos & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/egresos', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Egreso>> {
        return resolver(api.GET('/api/v1/egresos/{id}', { params: { path: { id } } }))
    }

    /** `POST /egresos` (`egresos.registrar`); 422 por campo (`no_aplica`, `futuro`, `periodo_cerrado`). */
    function registrar(cuerpo: CuerpoEgreso, claveIdempotencia: string): Promise<Resultado<Egreso>> {
        return resolver(api.POST('/api/v1/egresos', {
            body: cuerpo,
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `POST /egresos/:id/anular` (`egresos.anular`): asiento de reverso; 409 `egreso_anulado`. */
    function anular(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Egreso>> {
        return resolver(api.POST('/api/v1/egresos/{id}/anular', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    return { categorias, listar, ver, registrar, anular }
}
