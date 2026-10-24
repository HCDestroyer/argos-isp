import type { Schema, paths } from '@argosisp/contracts'

export type UsuarioPanel = Schema<'Usuario'>
export type AsignacionRol = Schema<'AsignacionRol'>
export type DatosUsuario = paths['/api/v1/usuarios']['post']['requestBody']['content']['application/json']
export type CambiosUsuario = paths['/api/v1/usuarios/{id}']['put']['requestBody']['content']['application/json']

export type AsignacionEmpresas = paths['/api/v1/usuarios/{id}/empresas']['put']['requestBody']['content']['application/json']

/** Usuarios del panel (`usuarios.ver`): la lista (también para filtros por actor), alta, edición y sus empresas. */
export function useUsuarios() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<UsuarioPanel>>> {
        const query: { limit: number, cursor?: string } = { limit: 200 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/usuarios', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<UsuarioPanel>> {
        return resolver(api.GET('/api/v1/usuarios/{id}', { params: { path: { id } } }))
    }

    /** `POST /usuarios` (`usuarios.crear`) con sus roles y alcances; 409 `email_duplicado`. */
    function crear(datos: DatosUsuario): Promise<Resultado<UsuarioPanel>> {
        return resolver(api.POST('/api/v1/usuarios', { body: datos }))
    }

    /**
     * `PUT /usuarios/:id` (`usuarios.editar`) con la `version` leída: datos, contraseña (opcional),
     * `activo` (desactivar) y la lista completa de roles. 422 `autodesactivacion` al desactivarse a sí mismo.
     */
    function editar(id: number, cambios: CambiosUsuario): Promise<Resultado<UsuarioPanel>> {
        return resolver(api.PUT('/api/v1/usuarios/{id}', { params: { path: { id } }, body: cambios }))
    }

    /**
     * `PUT /usuarios/:id/empresas` (`usuarios.asignar_empresas`): empresas que opera o alcance
     * global, con la `version` leída. 422 sin ninguna empresa; 403 fuera del alcance de quien asigna.
     */
    function asignarEmpresas(id: number, datos: AsignacionEmpresas): Promise<Resultado<UsuarioPanel>> {
        return resolver(api.PUT('/api/v1/usuarios/{id}/empresas', { params: { path: { id } }, body: datos }))
    }

    return { listar, ver, crear, editar, asignarEmpresas }
}
