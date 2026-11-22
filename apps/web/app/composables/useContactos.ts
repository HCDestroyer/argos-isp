import type { Schema, paths } from '@argosisp/contracts'

export type ContactoCliente = Schema<'ContactoCliente'>
export type DatosContacto = paths['/api/v1/clientes/{id}/contactos']['post']['requestBody']['content']['application/json']

/**
 * Contactos del cliente (A1, #281; contrato Iris 0.10.0 §3.5 y 0.10.1 §3.8): «A cargo de sus
 * servicios» (`GET /clientes/:id/contactos`, el titular primero), «Está a cargo de»
 * (`GET /clientes/:id/a-cargo`), alta y baja (`contactos.gestionar`, con `Idempotency-Key`).
 */
export function useContactos() {
    const api = useApi()

    function listar(clienteId: number): Promise<Resultado<{ data: ContactoCliente[] }>> {
        return resolver(api.GET('/api/v1/clientes/{id}/contactos', { params: { path: { id: clienteId } } }))
    }

    function aCargo(clienteId: number): Promise<Resultado<{ data: ContactoCliente[] }>> {
        return resolver(api.GET('/api/v1/clientes/{id}/a-cargo', { params: { path: { id: clienteId } } }))
    }

    function crear(clienteId: number, datos: DatosContacto, claveIdempotencia: string): Promise<Resultado<ContactoCliente>> {
        return resolver(api.POST('/api/v1/clientes/{id}/contactos', {
            params: { path: { id: clienteId }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    function quitar(contacto: Pick<ContactoCliente, 'contacto_id' | 'version'>, claveIdempotencia: string): Promise<Resultado<ContactoCliente>> {
        return resolver(api.DELETE('/api/v1/contactos/{id}', {
            params: { path: { id: contacto.contacto_id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { version: contacto.version },
        }))
    }

    return { listar, aCargo, crear, quitar }
}
