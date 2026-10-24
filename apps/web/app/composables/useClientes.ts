import type { Schema, paths } from '@argosisp/contracts'

export type Cliente = Schema<'Cliente'>
export type EstadoCuenta = Schema<'EstadoCuenta'>
export type DependientePago = Schema<'DependientePago'>
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

    /** `GET /clientes/:id/dependientes`: clientes de los que este es responsable de pago (cursor). */
    function dependientes(id: number, cursor?: string): Promise<Resultado<Pagina<DependientePago>>> {
        const query: { limit: number, cursor?: string } = { limit: 200 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/clientes/{id}/dependientes', { params: { path: { id }, query } }))
    }

    /**
     * `POST /clientes/:id/responsable-pago` (`clientes.asignar_responsable_pago`). 422 en
     * `responsable_id` si es él mismo, no existe o se formaría un ciclo o un segundo nivel.
     */
    function asignarResponsable(id: number, responsableId: number, motivo: string | null, claveIdempotencia: string): Promise<Resultado<Cliente>> {
        return resolver(api.POST('/api/v1/clientes/{id}/responsable-pago', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: motivo ? { responsable_id: responsableId, motivo } : { responsable_id: responsableId },
        }))
    }

    /** `POST /clientes/:id/quitar-responsable-pago` (`clientes.quitar_responsable_pago`). */
    function quitarResponsable(id: number, motivo: string | null, claveIdempotencia: string): Promise<Resultado<Cliente>> {
        return resolver(api.POST('/api/v1/clientes/{id}/quitar-responsable-pago', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: motivo ? { motivo } : {},
        }))
    }

    /**
     * `POST /clientes/:id/vincular-telegram` (`clientes.vincular_telegram`): el chat id que el cliente
     * obtiene al escribirle al bot; 422 si no es un número entero.
     */
    function vincularTelegram(id: number, chatId: string, claveIdempotencia: string): Promise<Resultado<Cliente>> {
        return resolver(api.POST('/api/v1/clientes/{id}/vincular-telegram', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { chat_id: chatId },
        }))
    }

    /** `POST /clientes/:id/desvincular-telegram` (`clientes.desvincular_telegram`). */
    function desvincularTelegram(id: number, claveIdempotencia: string): Promise<Resultado<Cliente>> {
        return resolver(api.POST('/api/v1/clientes/{id}/desvincular-telegram', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    return { listar, ver, crear, editar, estadoCuenta, dependientes, asignarResponsable, quitarResponsable, vincularTelegram, desvincularTelegram }
}
