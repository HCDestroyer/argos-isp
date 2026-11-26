import type { Schema, paths } from '@argosisp/contracts'

export type GestionCobro = Schema<'GestionCobro'>
export type GestionCobroRegistrada = Schema<'GestionCobroRegistrada'>
export type DatosGestionCobro = paths['/api/v1/clientes/{id}/gestiones-cobro']['post']['requestBody']['content']['application/json']

/** Gestiones de cobro de un cliente: llamadas, mensajes y visitas; son la evidencia para castigar cartera. */
export function useGestionesCobro() {
    const api = useApi()

    /** `GET /clientes/:id/gestiones-cobro` (`gestiones_cobro.ver`). */
    function listar(clienteId: number, cursor?: string): Promise<Resultado<Pagina<GestionCobro>>> {
        const query: { limit: number, cursor?: string } = { limit: 25 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/clientes/{id}/gestiones-cobro', { params: { path: { id: clienteId }, query } }))
    }

    /**
     * `POST /clientes/:id/gestiones-cobro` (`gestiones_cobro.registrar`): lo ocurrido entre hace 7
     * días y ahora (422 `fuera_de_ventana`). Desde el panel el origen es `panel` y la nota es libre
     * (hasta 280 caracteres); `carta` solo se registra desde aquí.
     */
    function registrar(clienteId: number, datos: DatosGestionCobro, claveIdempotencia: string): Promise<Resultado<GestionCobroRegistrada>> {
        return resolver(api.POST('/api/v1/clientes/{id}/gestiones-cobro', {
            params: { path: { id: clienteId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { listar, registrar }
}
