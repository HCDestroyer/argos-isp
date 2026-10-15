import type { Schema, paths } from '@argosisp/contracts'

export type Cliente = Schema<'Cliente'>
export type EstadoCuenta = Schema<'EstadoCuenta'>
export type FiltrosClientes = Omit<NonNullable<paths['/api/v1/clientes']['get']['parameters']['query']>, 'cursor'>
export type DatosCliente = paths['/api/v1/clientes']['post']['requestBody']['content']['application/json']
export type CambiosCliente = paths['/api/v1/clientes/{id}']['put']['requestBody']['content']['application/json']

/** Tamaño de página de la lista de clientes. */
export const LIMITE_CLIENTES = 20

/** Clientes: búsqueda, ficha, alta, edición y estado de cuenta. */
export function useClientes() {
    const api = useApi()

    function listar(filtros: FiltrosClientes = {}, cursor?: string): Promise<Resultado<Pagina<Cliente>>> {
        const query: FiltrosClientes & { cursor?: string } = { limit: LIMITE_CLIENTES, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        if (!query.q) {
            delete query.q
        }
        return resolver(api.GET('/api/v1/clientes', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Cliente>> {
        return resolver(api.GET('/api/v1/clientes/{id}', { params: { path: { id } } }))
    }

    /** `POST /clientes` con `Idempotency-Key`: reintentar con la misma clave no duplica el cliente. */
    function crear(datos: DatosCliente, claveIdempotencia: string): Promise<Resultado<Cliente>> {
        return resolver(api.POST('/api/v1/clientes', {
            body: datos,
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    /** `PUT /clientes/:id` con la `version` leída; si alguien más editó, la API responde 409. */
    function editar(id: number, cambios: CambiosCliente): Promise<Resultado<Cliente>> {
        return resolver(api.PUT('/api/v1/clientes/{id}', { params: { path: { id } }, body: cambios }))
    }

    function estadoCuenta(id: number): Promise<Resultado<EstadoCuenta>> {
        return resolver(api.GET('/api/v1/clientes/{id}/estado-cuenta', { params: { path: { id } } }))
    }

    return { listar, ver, crear, editar, estadoCuenta }
}
