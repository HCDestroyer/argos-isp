import type { Schema } from '@argosisp/contracts'

export type PermisoCatalogo = Schema<'Permiso'>

/** Catálogo de permisos del ACL (`GET /permisos`, `roles.ver`) con su descripción. */
export function useCatalogoPermisos() {
    const api = useApi()

    function listar(): Promise<Resultado<PermisoCatalogo[]>> {
        return resolver(api.GET('/api/v1/permisos'))
    }

    return { listar }
}
