import type { paths } from '@argosisp/contracts'

export type NuevoContacto = paths['/api/v1/portal/contactos']['post']['requestBody']['content']['application/json']
export type CambiosContactoCliente = paths['/api/v1/portal/contactos/{contactoId}']['put']['requestBody']['content']['application/json']

/**
 * «Mis contactos» del titular (`/portal/contactos`, contrato Iris 0.10.0 §3.5): quién más puede
 * consultar, reportar, pagar o recibir avisos de sus servicios. Las reglas (números en E.164, un
 * principal, titular intocable) las aplica la API; el formulario solo ayuda antes de enviar.
 */
export function useContactosCliente() {
    const api = useApi()

    function listar() {
        return resolver(api.GET('/api/v1/portal/contactos'))
    }

    function agregar(cuerpo: NuevoContacto, clave: string) {
        return resolver(api.POST('/api/v1/portal/contactos', {
            params: { header: { 'Idempotency-Key': clave } },
            body: cuerpo,
        }))
    }

    function cambiar(id: number, cambios: CambiosContactoCliente) {
        return resolver(api.PUT('/api/v1/portal/contactos/{contactoId}', {
            params: { path: { contactoId: id } },
            body: cambios,
        }))
    }

    function quitar(id: number, version: number) {
        return resolver(api.POST('/api/v1/portal/contactos/{contactoId}/quitar', {
            params: { path: { contactoId: id } },
            body: { version },
        }))
    }

    return { listar, agregar, cambiar, quitar }
}
