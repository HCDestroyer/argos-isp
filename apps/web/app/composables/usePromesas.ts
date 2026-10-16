import type { Schema, paths } from '@argosisp/contracts'

export type Promesa = Schema<'Promesa'>
export type EstadoPromesa = Promesa['estado']
export type CanalPromesa = Promesa['canal']
export type DatosPromesa = paths['/api/v1/promesas']['post']['requestBody']['content']['application/json']
export type FiltrosPromesas = Omit<NonNullable<paths['/api/v1/promesas']['get']['parameters']['query']>, 'cursor'>

export const LIMITE_PROMESAS = 25

/** Promesas de pago: lista, alta (la API evalúa las reglas de la plantilla) y aprobación. */
export function usePromesas() {
    const api = useApi()

    function listar(filtros: FiltrosPromesas = {}, cursor?: string): Promise<Resultado<Pagina<Promesa>>> {
        const query: FiltrosPromesas & { cursor?: string } = { limit: LIMITE_PROMESAS, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/promesas', { params: { query } }))
    }

    /**
     * `POST /promesas` (`promesas.crear`): responde 201 tanto si la promesa queda activa como si
     * se rechaza o queda pendiente; `resultado_evaluacion` dice qué regla decidió.
     */
    function crear(datos: DatosPromesa, claveIdempotencia: string): Promise<Resultado<Promesa>> {
        return resolver(api.POST('/api/v1/promesas', {
            body: datos,
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `POST /promesas/:id/aprobar` (`promesas.aprobar`) con nota opcional. */
    function aprobar(id: number, nota: string | null, claveIdempotencia: string): Promise<Resultado<Promesa>> {
        return resolver(api.POST('/api/v1/promesas/{id}/aprobar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { nota },
        }))
    }

    return { listar, crear, aprobar }
}
