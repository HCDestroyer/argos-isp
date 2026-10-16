import type { Schema, paths } from '@argosisp/contracts'

export type ContactoPortal = Schema<'PortalContacto'>
export type CambiosContacto = paths['/api/v1/portal/contacto']['put']['requestBody']['content']['application/json']

/**
 * Datos de contacto y canal preferido del cliente de la sesión (`PUT /portal/contacto`).
 * Va con la `version` leída: si la oficina los cambió mientras tanto, la API responde 409.
 */
export function useContacto() {
    const api = useApi()

    function editar(cambios: CambiosContacto): Promise<Resultado<ContactoPortal>> {
        return resolver(api.PUT('/api/v1/portal/contacto', { body: cambios }))
    }

    return { editar }
}
