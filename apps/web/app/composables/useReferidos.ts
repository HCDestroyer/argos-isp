import type { Schema, paths } from '@argosisp/contracts'

export type ReferidoLealtad = Schema<'ReferidoLealtad'>
export type EstadoReferido = ReferidoLealtad['estado']
export type FiltrosReferidos = Omit<NonNullable<paths['/api/v1/lealtad/referidos']['get']['parameters']['query']>, 'cursor'>

/**
 * Referidos (A3, `contratos/lealtad.md` §4): se registran solos al crear el servicio del cliente
 * referido y califican con sus facturas pagadas. Rechazar pide motivo y revierte lo otorgado.
 */
export function useReferidos() {
    const api = useApi()

    function listar(filtros: FiltrosReferidos = {}, cursor?: string): Promise<Resultado<Pagina<ReferidoLealtad>>> {
        const query: FiltrosReferidos & { cursor?: string } = { limit: 25, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/lealtad/referidos', { params: { query } }))
    }

    /** `POST /lealtad/referidos/:id/rechazar` (`lealtad.ajustar`): 409 `referido_rechazado`. */
    function rechazar(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<ReferidoLealtad>> {
        return resolver(api.POST('/api/v1/lealtad/referidos/{id}/rechazar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    return { listar, rechazar }
}
