import type { Schema, paths } from '@argosisp/contracts'

export type Promesa = Schema<'Promesa'>
export type EstadoPromesa = Promesa['estado']
export type CanalPromesa = Promesa['canal']
export type DatosPromesa = paths['/api/v1/promesas']['post']['requestBody']['content']['application/json']
export type FiltrosPromesas = Omit<NonNullable<paths['/api/v1/promesas']['get']['parameters']['query']>, 'cursor'>

export type SimulacionPromesa = Schema<'SimulacionPromesa'>

export const LIMITE_PROMESAS = 25

/** Promesas de pago: lista, alta (la API evalúa las reglas de la plantilla), simulación, aprobación, rechazo y cancelación. */
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

    /** `POST /promesas/:id/rechazar` (`promesas.rechazar`): solo pendientes; motivo obligatorio. */
    function rechazar(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Promesa>> {
        return resolver(api.POST('/api/v1/promesas/{id}/rechazar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /**
     * `POST /promesas/:id/cancelar` (`promesas.cancelar`): activa o pendiente. Si estaba activa, la
     * API re-evalúa el servicio y puede volver a cortarlo.
     */
    function cancelar(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Promesa>> {
        return resolver(api.POST('/api/v1/promesas/{id}/cancelar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /**
     * `POST /promesas/simular` (`promesas.ver`): evalúa todas las reglas sin crear nada ni dejar
     * auditoría. `resultado` y `regla` son los mismos que daría `POST /promesas`.
     */
    function simular(datos: CuerpoSimulacion): Promise<Resultado<SimulacionPromesa>> {
        return resolver(api.POST('/api/v1/promesas/simular', { body: datos }))
    }

    return { listar, crear, aprobar, rechazar, cancelar, simular }
}
