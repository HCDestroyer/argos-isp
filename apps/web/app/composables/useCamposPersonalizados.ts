import type { paths, Schema } from '@argosisp/contracts'

export type CampoPersonalizado = Schema<'CampoPersonalizado'>
export type TipoCampoPersonalizado = CampoPersonalizado['tipo']
export type CrearCampoPersonalizado = paths['/api/v1/campos-personalizados']['post']['requestBody']['content']['application/json']
export type EditarCampoPersonalizado = paths['/api/v1/campos-personalizados/{id}']['put']['requestBody']['content']['application/json']

/**
 * Catálogo de campos personalizados del cliente (A1, `core/campos_personalizados.ts`): qué claves
 * de `Cliente.campos_personalizados` existen, su tipo, si son requeridas y su orden en la ficha.
 * Se lee con `clientes.ver`; solo `admin` lo cambia (`campos_personalizados.*`).
 */
export function useCamposPersonalizados() {
    const api = useApi()

    /** `GET /campos-personalizados` (sin paginar: el catálogo es corto); `activo` filtra. */
    function listar(activo?: boolean): Promise<Resultado<CampoPersonalizado[]>> {
        return resolver(api.GET('/api/v1/campos-personalizados', { params: { query: activo === undefined ? {} : { activo } } }))
    }

    /** `POST` (`campos_personalizados.crear`): 409 `campo_duplicado` si la clave ya existe. */
    function crear(cuerpo: CrearCampoPersonalizado): Promise<Resultado<CampoPersonalizado>> {
        return resolver(api.POST('/api/v1/campos-personalizados', { body: cuerpo }))
    }

    /** `PUT /:id` (`campos_personalizados.editar`, con `version`): `clave` y `tipo` no cambian. */
    function editar(id: number, cuerpo: EditarCampoPersonalizado): Promise<Resultado<CampoPersonalizado>> {
        return resolver(api.PUT('/api/v1/campos-personalizados/{id}', { params: { path: { id } }, body: cuerpo }))
    }

    /** `POST /:id/desactivar`: no se muestra ni se valida; los valores guardados se conservan. */
    function desactivar(campo: Pick<CampoPersonalizado, 'id' | 'version'>): Promise<Resultado<CampoPersonalizado>> {
        return resolver(api.POST('/api/v1/campos-personalizados/{id}/desactivar', { params: { path: { id: campo.id } }, body: { version: campo.version } }))
    }

    /** `POST /:id/activar`. */
    function activar(campo: Pick<CampoPersonalizado, 'id' | 'version'>): Promise<Resultado<CampoPersonalizado>> {
        return resolver(api.POST('/api/v1/campos-personalizados/{id}/activar', { params: { path: { id: campo.id } }, body: { version: campo.version } }))
    }

    return { listar, crear, editar, desactivar, activar }
}
