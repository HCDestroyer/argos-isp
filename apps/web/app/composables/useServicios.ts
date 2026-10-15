import type { Schema, paths } from '@argosisp/contracts'

export type Servicio = Schema<'Servicio'>
export type DatosServicio = paths['/api/v1/servicios']['post']['requestBody']['content']['application/json']
export type ModoIpv6 = Servicio['ipv6_modo']
export type FiltrosServicios = Omit<NonNullable<paths['/api/v1/servicios']['get']['parameters']['query']>, 'cursor'>

/** Servicios PPPoE: lista, ficha y alta. */
export function useServicios() {
    const api = useApi()

    function listar(filtros: FiltrosServicios = {}, cursor?: string): Promise<Resultado<Pagina<Servicio>>> {
        const query: FiltrosServicios & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/servicios', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Servicio>> {
        return resolver(api.GET('/api/v1/servicios/{id}', { params: { path: { id } } }))
    }

    /** `POST /servicios` con `Idempotency-Key`: asigna IPv4/IPv6 y crea las credenciales PPP. */
    function crear(datos: DatosServicio, claveIdempotencia: string): Promise<Resultado<Servicio>> {
        return resolver(api.POST('/api/v1/servicios', {
            body: datos,
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    return { listar, ver, crear }
}
