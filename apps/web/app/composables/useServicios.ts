import type { Schema, paths } from '@argosisp/contracts'

export type Servicio = Schema<'Servicio'>
export type CredencialesPpp = Schema<'CredencialesPpp'>
export type DatosServicio = paths['/api/v1/servicios']['post']['requestBody']['content']['application/json']
export type ModoIpv6 = Servicio['ipv6_modo']
export type FiltrosServicios = Omit<NonNullable<paths['/api/v1/servicios']['get']['parameters']['query']>, 'cursor'>

/** Tamaño de página de la lista de servicios. */
export const LIMITE_SERVICIOS = 25

/**
 * Acciones de dominio sobre un servicio, cada una con su endpoint y su permiso del mismo
 * nombre (`POST /servicios/:id/quitar-limite` ↔ `servicios.quitar_limite`). Todas piden motivo.
 */
export type AccionServicio = 'suspender' | 'reactivar' | 'limitar' | 'quitar_limite' | 'retirar' | 'desconectar'

type RutaAccion = '/api/v1/servicios/{id}/suspender'
    | '/api/v1/servicios/{id}/reactivar'
    | '/api/v1/servicios/{id}/limitar'
    | '/api/v1/servicios/{id}/quitar-limite'
    | '/api/v1/servicios/{id}/retirar'
    | '/api/v1/servicios/{id}/desconectar'

export const RUTAS_ACCION_SERVICIO: Record<AccionServicio, RutaAccion> = {
    suspender: '/api/v1/servicios/{id}/suspender',
    reactivar: '/api/v1/servicios/{id}/reactivar',
    limitar: '/api/v1/servicios/{id}/limitar',
    quitar_limite: '/api/v1/servicios/{id}/quitar-limite',
    retirar: '/api/v1/servicios/{id}/retirar',
    desconectar: '/api/v1/servicios/{id}/desconectar',
}

/** Servicios PPPoE: lista, ficha, alta, credenciales y acciones de estado. */
export function useServicios() {
    const api = useApi()

    function listar(filtros: FiltrosServicios = {}, cursor?: string): Promise<Resultado<Pagina<Servicio>>> {
        const query: FiltrosServicios & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        if (!query.q) {
            delete query.q
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

    /** Usuario y contraseña PPPoE en claro (`servicios.ver_credenciales`). Cada consulta queda auditada. */
    function credenciales(id: number): Promise<Resultado<CredencialesPpp>> {
        return resolver(api.GET('/api/v1/servicios/{id}/credenciales', { params: { path: { id } } }))
    }

    /**
     * Ejecuta una acción explícita (`POST /servicios/:id/suspender`…) con motivo e
     * `Idempotency-Key`. Devuelve el servicio después de la acción.
     */
    function ejecutar(id: number, accion: AccionServicio, motivo: string, claveIdempotencia: string): Promise<Resultado<Servicio>> {
        return resolver(api.POST(RUTAS_ACCION_SERVICIO[accion], {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    return { listar, ver, crear, credenciales, ejecutar }
}
