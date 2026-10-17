import type { Schema, paths } from '@argosisp/contracts'

export type NotaCredito = Schema<'NotaCredito'>
export type FiltrosNotasCredito = Omit<NonNullable<paths['/api/v1/notas-credito']['get']['parameters']['query']>, 'cursor'>

export const LIMITE_NOTAS_CREDITO = 25

/**
 * Notas de crédito internas (A3), solo lectura con `facturas.ver`. Se emiten desde el detalle
 * de la factura (`useFacturas().notaCredito`, `facturas.nota_credito`).
 */
export function useNotasCredito() {
    const api = useApi()

    /** `GET /notas-credito` por cliente, factura o fecha contable, con paginación por cursor. */
    function listar(filtros: FiltrosNotasCredito = {}, cursor?: string): Promise<Resultado<Pagina<NotaCredito>>> {
        const query: FiltrosNotasCredito & { cursor?: string } = { limit: LIMITE_NOTAS_CREDITO, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/notas-credito', { params: { query } }))
    }

    /** `GET /notas-credito/:id`. */
    function ver(id: number): Promise<Resultado<NotaCredito>> {
        return resolver(api.GET('/api/v1/notas-credito/{id}', { params: { path: { id } } }))
    }

    return { listar, ver }
}
