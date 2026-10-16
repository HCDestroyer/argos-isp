import type { Schema, paths } from '@argosisp/contracts'

export type Caja = Schema<'Caja'>
export type TurnoCaja = Schema<'CajaTurno'>
export type DatosCierre = paths['/api/v1/cajas/{id}/cerrar']['post']['requestBody']['content']['application/json']

/** Cajas y sus turnos: abrir con fondo inicial, cerrar con arqueo (contado y motivo). */
export function useCajas() {
    const api = useApi()

    function listar(): Promise<Resultado<Caja[]>> {
        return resolver(api.GET('/api/v1/cajas'))
    }

    function turnos(cajaId: number, cursor?: string): Promise<Resultado<Pagina<TurnoCaja>>> {
        const query: { limit: number, cursor?: string } = { limit: 20 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cajas/{id}/turnos', { params: { path: { id: cajaId }, query } }))
    }

    /** `POST /cajas/:id/abrir` (`cajas.abrir`) con el fondo inicial en string decimal. */
    function abrir(cajaId: number, fondoInicial: string, claveIdempotencia: string): Promise<Resultado<TurnoCaja>> {
        return resolver(api.POST('/api/v1/cajas/{id}/abrir', {
            params: { path: { id: cajaId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { fondo_inicial: fondoInicial },
        }))
    }

    /**
     * `POST /cajas/:id/cerrar` (`cajas.cerrar`): la API calcula el esperado y la diferencia;
     * el motivo es obligatorio si contado ≠ esperado.
     */
    function cerrar(cajaId: number, datos: DatosCierre, claveIdempotencia: string): Promise<Resultado<TurnoCaja>> {
        return resolver(api.POST('/api/v1/cajas/{id}/cerrar', {
            params: { path: { id: cajaId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { listar, turnos, abrir, cerrar }
}
