import type { Schema } from '@argosisp/contracts'

export type UsuarioPanel = Schema<'Usuario'>

/** Usuarios del panel (`usuarios.ver`). Hoy solo la lista, para filtros por actor. */
export function useUsuarios() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<UsuarioPanel>>> {
        const query: { limit: number, cursor?: string } = { limit: 200 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/usuarios', { params: { query } }))
    }

    return { listar }
}
