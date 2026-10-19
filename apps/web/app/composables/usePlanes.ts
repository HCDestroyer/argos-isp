import type { Schema, paths } from '@argosisp/contracts'

export type Plan = Schema<'Plan'>
export type FiltrosPlanes = Omit<NonNullable<paths['/api/v1/planes']['get']['parameters']['query']>, 'cursor'>
export type DatosPlan = paths['/api/v1/planes']['post']['requestBody']['content']['application/json']
export type CambiosPlan = paths['/api/v1/planes/{id}']['put']['requestBody']['content']['application/json']
export type AdicionalPlan = Schema<'AdicionalPlan'>
export type ListaAdicionalesPlan = paths['/api/v1/planes/{id}/adicionales']['put']['requestBody']['content']['application/json']['adicionales']

/** Planes de velocidad: lista, alta y edición (con `version`; 409 si alguien lo cambió). */
export function usePlanes() {
    const api = useApi()

    function listar(filtros: FiltrosPlanes = {}, cursor?: string): Promise<Resultado<Pagina<Plan>>> {
        const query: FiltrosPlanes & { cursor?: string } = { limit: 200, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/planes', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Plan>> {
        return resolver(api.GET('/api/v1/planes/{id}', { params: { path: { id } } }))
    }

    /** `POST /planes` (`planes.crear`); 422 por campo, también las reglas cruzadas de velocidad. */
    function crear(datos: DatosPlan): Promise<Resultado<Plan>> {
        return resolver(api.POST('/api/v1/planes', { body: datos }))
    }

    /** `PUT /planes/:id` (`planes.editar`) con la `version` leída. */
    function editar(id: number, cambios: CambiosPlan): Promise<Resultado<Plan>> {
        return resolver(api.PUT('/api/v1/planes/{id}', { params: { path: { id } }, body: cambios }))
    }

    /**
     * `POST /planes/vista-previa` (`planes.ver`): el rate-limit activo y limitado y la cola padre
     * con `activos` servicios, calculados por la API con la misma función que usan aaa y el
     * dispatcher. No guarda nada; 422 por campo con las reglas de crear el plan.
     */
    function vistaPrevia(datos: DatosVistaPreviaPlan): Promise<Resultado<VistaPreviaVelocidad>> {
        return resolver(api.POST('/api/v1/planes/vista-previa', { body: datos }))
    }

    /** `GET /planes/:id/adicionales` (`planes.ver`): los que trae el plan, de cualquier empresa, con su `cantidad`. */
    function adicionales(id: number): Promise<Resultado<AdicionalPlan[]>> {
        return resolver(api.GET('/api/v1/planes/{id}/adicionales', { params: { path: { id } } }))
    }

    /**
     * `PUT /planes/:id/adicionales` (`planes.editar`): reemplaza la lista con la `version` del plan
     * (la sube; 409 si cambió). No toca los servicios existentes: aplica al próximo alta o cambio de plan.
     */
    function definirAdicionales(id: number, version: number, lista: ListaAdicionalesPlan): Promise<Resultado<AdicionalPlan[]>> {
        return resolver(api.PUT('/api/v1/planes/{id}/adicionales', { params: { path: { id } }, body: { version, adicionales: lista } }))
    }

    return { listar, ver, crear, editar, vistaPrevia, adicionales, definirAdicionales }
}
