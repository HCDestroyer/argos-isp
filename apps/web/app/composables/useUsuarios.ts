import type { Schema, paths } from '@argosisp/contracts'

export type UsuarioPanel = Schema<'Usuario'>

export type AsignacionEmpresas = paths['/api/v1/usuarios/{id}/empresas']['put']['requestBody']['content']['application/json']

/** Usuarios del panel (`usuarios.ver`): la lista (también para filtros por actor) y sus empresas. */
export function useUsuarios() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<UsuarioPanel>>> {
        const query: { limit: number, cursor?: string } = { limit: 200 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/usuarios', { params: { query } }))
    }

    /**
     * `PUT /usuarios/:id/empresas` (`usuarios.asignar_empresas`): empresas que opera o alcance
     * global, con la `version` leída. 422 sin ninguna empresa; 403 fuera del alcance de quien asigna.
     */
    function asignarEmpresas(id: number, datos: AsignacionEmpresas): Promise<Resultado<UsuarioPanel>> {
        return resolver(api.PUT('/api/v1/usuarios/{id}/empresas', { params: { path: { id } }, body: datos }))
    }

    return { listar, asignarEmpresas }
}
