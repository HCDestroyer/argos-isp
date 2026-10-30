import type { Schema, paths } from '@argosisp/contracts'

export type PerfilQos = Schema<'PerfilQos'>
export type PerfilQosDetalle = Schema<'PerfilQosDetalle'>
export type ClaseQos = Schema<'ClaseQos'>
export type ReglaQos = Schema<'ReglaQos'>
export type UsoPerfilQos = Schema<'UsoPerfilQos'>
export type DatosPerfilQos = paths['/api/v1/qos/perfiles']['post']['requestBody']['content']['application/json']
export type DatosClaseQos = paths['/api/v1/qos/perfiles/{id}/clases']['post']['requestBody']['content']['application/json']
export type CambiosClaseQos = paths['/api/v1/qos/clases/{id}']['put']['requestBody']['content']['application/json']
export type PerfilRouterQos = paths['/api/v1/routers/{id}/qos-perfil']['post']['requestBody']['content']['application/json']

/**
 * Prioridad por protocolo (QoS por clases, `contratos/qos.md`, A2): perfiles con sus clases, su
 * costo en cada router y el perfil de un router. Ver con `qos.ver`; todo lo que escribe es
 * `qos.gestionar`. Las ediciones llevan `version` (409 si alguien cambió la clase o el router).
 */
export function useQos() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<PerfilQos>>> {
        return resolver(api.GET('/api/v1/qos/perfiles', { params: { query: { limit: 50, ...(cursor ? { cursor } : {}) } } }))
    }

    /** Todos los perfiles visibles (hasta 4 páginas de 200), para elegir uno. */
    async function todos(): Promise<Resultado<PerfilQos[]>> {
        const filas: PerfilQos[] = []
        let cursor: string | undefined
        for (let pagina = 0; pagina < 4; pagina++) {
            const resultado = await resolver(api.GET('/api/v1/qos/perfiles', { params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } } }))
            if (!resultado.ok) {
                return resultado
            }
            filas.push(...resultado.data.data)
            if (!resultado.data.nextCursor) {
                break
            }
            cursor = resultado.data.nextCursor
        }
        return { ok: true, data: filas }
    }

    /** Perfil con sus clases, advertencias y `routers[]` (planes con qos y hojas contra el límite). */
    function ver(id: number): Promise<Resultado<PerfilQosDetalle>> {
        return resolver(api.GET('/api/v1/qos/perfiles/{id}', { params: { path: { id } } }))
    }

    /** `POST /qos/perfiles`: copia las clases activas de `copiar_de` (por defecto, del predeterminado). */
    function crearPerfil(datos: DatosPerfilQos, claveIdempotencia: string): Promise<Resultado<PerfilQos>> {
        return resolver(api.POST('/api/v1/qos/perfiles', { params: { header: { 'Idempotency-Key': claveIdempotencia } }, body: datos }))
    }

    function crearClase(perfilId: number, datos: DatosClaseQos, claveIdempotencia: string): Promise<Resultado<ClaseQos>> {
        return resolver(api.POST('/api/v1/qos/perfiles/{id}/clases', { params: { path: { id: perfilId }, header: { 'Idempotency-Key': claveIdempotencia } }, body: datos }))
    }

    function editarClase(id: number, cambios: CambiosClaseQos): Promise<Resultado<ClaseQos>> {
        return resolver(api.PUT('/api/v1/qos/clases/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** Activar o desactivar (`resto` no se desactiva: 422 `qos_resto`). */
    function cambiarEstado(clase: Pick<ClaseQos, 'id' | 'version'>, activa: boolean, claveIdempotencia: string): Promise<Resultado<ClaseQos>> {
        const opciones = { params: { path: { id: clase.id }, header: { 'Idempotency-Key': claveIdempotencia } }, body: { version: clase.version } }
        return resolver(activa
            ? api.POST('/api/v1/qos/clases/{id}/activar', opciones)
            : api.POST('/api/v1/qos/clases/{id}/desactivar', opciones))
    }

    /** `POST /routers/:id/qos-perfil`: `qos_perfil_id` null = el predeterminado. */
    function asignarPerfil(routerId: number, datos: PerfilRouterQos): Promise<Resultado<RouterNas>> {
        return resolver(api.POST('/api/v1/routers/{id}/qos-perfil', { params: { path: { id: routerId } }, body: datos }))
    }

    return { listar, todos, ver, crearPerfil, crearClase, editarClase, cambiarEstado, asignarPerfil }
}
