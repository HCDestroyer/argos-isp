import type { Schema } from '@argosisp/contracts'

export type NodoPortal = Schema<'NodoPortal'>
export type NodoPortalCreado = Schema<'NodoPortalCreado'>

/** Nodos portal remotos (A5): portales del cliente que corren fuera del central y llaman con su token. */
export function useNodosPortal() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<NodoPortal>>> {
        const query: { limit: number, cursor?: string } = { limit: 50 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/nodos-portal', { params: { query } }))
    }

    /** `POST /nodos-portal` (`nodos_portal.administrar`): el token `argn_…` llega una sola vez. */
    function crear(nombre: string): Promise<Resultado<NodoPortalCreado>> {
        return resolver(api.POST('/api/v1/nodos-portal', { body: { nombre } }))
    }

    /** `POST /nodos-portal/:id/revocar`: el nodo recibe 401 desde su siguiente petición. */
    function revocar(id: number): Promise<Resultado<NodoPortal>> {
        return resolver(api.POST('/api/v1/nodos-portal/{id}/revocar', { params: { path: { id } } }))
    }

    return { listar, crear, revocar }
}
