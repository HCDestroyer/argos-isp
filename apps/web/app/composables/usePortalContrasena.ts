import type { Schema, paths } from '@argosisp/contracts'

export type PortalContrasenaDefecto = Schema<'PortalContrasenaDefecto'>
export type ClienteContrasenaPortal = Schema<'ClienteContrasenaPortal'>
export type CuerpoContrasenaDefecto = paths['/api/v1/empresa/contrasena-portal']['put']['requestBody']['content']['application/json']

/**
 * Contraseña del portal del cliente (A5): la por defecto de la empresa activa y, por cliente, si
 * usa la suya o la de la empresa. La API nunca devuelve la contraseña ni su hash.
 */
export function usePortalContrasena() {
    const api = useApi()

    /**
     * `GET /empresa/contrasena-portal` (`empresa.ver`) de la empresa activa: `version` 0 = nunca se
     * configuró. Sin empresa activa, 422 `empresa_requerida`.
     */
    function verDefecto(): Promise<Resultado<PortalContrasenaDefecto>> {
        return resolver(api.GET('/api/v1/empresa/contrasena-portal'))
    }

    /**
     * `PUT /empresa/contrasena-portal` (`portal.configurar_contrasena_defecto`) con la `version`
     * leída: 409 `conflicto_version` si cambió, 422 en `contrasena` (8 a 128).
     */
    function configurarDefecto(cuerpo: CuerpoContrasenaDefecto): Promise<Resultado<PortalContrasenaDefecto>> {
        return resolver(api.PUT('/api/v1/empresa/contrasena-portal', { body: cuerpo }))
    }

    /** `GET /clientes/:id/contrasena-portal` (`clientes.ver`): propia o la de la empresa. */
    function verCliente(id: number): Promise<Resultado<ClienteContrasenaPortal>> {
        return resolver(api.GET('/api/v1/clientes/{id}/contrasena-portal', { params: { path: { id } } }))
    }

    /**
     * `POST /clientes/:id/restaurar-contrasena-portal` (`clientes.restaurar_contrasena_portal`):
     * borra la propia y cierra sus sesiones del portal (`sesiones_cerradas`). Idempotente, sin cuerpo.
     */
    function restaurarCliente(id: number): Promise<Resultado<ClienteContrasenaPortal>> {
        return resolver(api.POST('/api/v1/clientes/{id}/restaurar-contrasena-portal', { params: { path: { id } } }))
    }

    return { verDefecto, configurarDefecto, verCliente, restaurarCliente }
}
