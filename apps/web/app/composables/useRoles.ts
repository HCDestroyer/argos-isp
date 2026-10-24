import type { Schema, paths } from '@argosisp/contracts'

export type Rol = Schema<'Rol'>
export type DatosRol = paths['/api/v1/roles']['post']['requestBody']['content']['application/json']
export type CambiosRol = paths['/api/v1/roles/{id}']['put']['requestBody']['content']['application/json']
/** Nombre de permiso del catálogo de la API (`apps/api/app/core/permisos.ts`). */
export type NombrePermiso = DatosRol['permisos'][number]

/** Roles del ACL con sus permisos (`roles.ver`): lista, alta y edición con `version`. */
export function useRoles() {
    const api = useApi()

    function listar(): Promise<Resultado<Rol[]>> {
        return resolver(api.GET('/api/v1/roles'))
    }

    /** `POST /roles` (`roles.crear`); 409 `rol_duplicado`, 422 con un permiso desconocido. */
    function crear(datos: DatosRol): Promise<Resultado<Rol>> {
        return resolver(api.POST('/api/v1/roles', { body: datos }))
    }

    /**
     * `PUT /roles/:id` (`roles.editar`): descripción y la lista completa de permisos, con la
     * `version` leída. Los permisos de un rol base se definen en código: 422 `rol_base`.
     */
    function editar(id: number, cambios: CambiosRol): Promise<Resultado<Rol>> {
        return resolver(api.PUT('/api/v1/roles/{id}', { params: { path: { id } }, body: cambios }))
    }

    return { listar, crear, editar }
}
