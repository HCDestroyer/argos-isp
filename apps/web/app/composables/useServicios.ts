import type { Schema, paths } from '@argosisp/contracts'

export type Servicio = Schema<'Servicio'>
export type CredencialesPpp = Schema<'CredencialesPpp'>
export type DatosServicio = paths['/api/v1/servicios']['post']['requestBody']['content']['application/json']
export type ModoIpv6 = Servicio['ipv6_modo']
export type TramoAsignacion = Schema<'TramoAsignacion'>
export type ConfiguracionEfectivaServicio = Schema<'ConfiguracionEfectivaServicio'>
/** Cuerpo de `POST /servicios/:id/activar-instalacion` (`contratos/instalacion.md` §2). */
export type DatosActivarInstalacion = paths['/api/v1/servicios/{id}/activar-instalacion']['post']['requestBody']['content']['application/json']
/** Referencia de planta (caja, puerto, OLT, slot, PON, potencia), de solo lectura. */
export type PlantaServicio = NonNullable<Servicio['planta']>
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

    /** Historial de asignaciones (router, plan, IPv4, prefijos), del tramo más reciente al más viejo. */
    function asignaciones(id: number, cursor?: string): Promise<Resultado<Pagina<TramoAsignacion>>> {
        const query: { limit: number, cursor?: string } = { limit: 20 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/servicios/{id}/asignaciones', { params: { path: { id }, query } }))
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

    /**
     * `PUT /servicios/:id` (`servicios.editar`) con la `version` leída: 409 si cambió, 422 por
     * campo (`validarTipoConexion`). Cambiar el tipo de conexión borra o genera las credenciales.
     */
    function editar(id: number, cambios: CambiosServicio): Promise<Resultado<Servicio>> {
        return resolver(api.PUT('/api/v1/servicios/{id}', { params: { path: { id } }, body: cambios }))
    }

    /**
     * `POST /servicios/:id/cambiar-empresa` (`servicios.cambiar_empresa`): pasa el servicio a otra
     * empresa (NIT). 422 `servicio_con_saldo` si tiene saldo pendiente, 403 `empresa_no_permitida`.
     */
    function cambiarEmpresa(id: number, datos: { empresa_id: number, version: number, motivo: string }, claveIdempotencia: string): Promise<Resultado<Servicio>> {
        return resolver(api.POST('/api/v1/servicios/{id}/cambiar-empresa', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /**
     * `GET /servicios/:id/configuracion-efectiva` (`servicios.ver`): el plan como queda en su router
     * (rate-limit, profile, pools) y la plantilla con las excepciones del servicio aplicadas.
     */
    function configuracionEfectiva(id: number): Promise<Resultado<ConfiguracionEfectivaServicio>> {
        return resolver(api.GET('/api/v1/servicios/{id}/configuracion-efectiva', { params: { path: { id } } }))
    }

    /**
     * `POST /servicios/:id/activar-instalacion` (`servicios.activar_instalacion`): pasa un
     * `pendiente_instalacion` a `activo` e inicia la facturación. `Idempotency-Key` obligatoria y
     * `version` (409); 422 `servicio_no_pendiente` si ya no está pendiente, o por campo
     * (`instalado_en` futura o anterior al alta, `planta.potencia_dbm` fuera de rango).
     */
    function activarInstalacion(id: number, datos: DatosActivarInstalacion, claveIdempotencia: string): Promise<Resultado<Servicio>> {
        return resolver(api.POST('/api/v1/servicios/{id}/activar-instalacion', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `GET /servicios/:id/eliminable` (`servicios.ver`): si nunca se usó y, si no, los motivos. */
    function eliminable(id: number): Promise<Resultado<Eliminable>> {
        return resolver(api.GET('/api/v1/servicios/{id}/eliminable', { params: { path: { id } } }))
    }

    /**
     * `DELETE /servicios/:id?version=N` (`servicios.eliminar`, solo admin): 204; la IPv4 y los
     * prefijos quedan libres. 409 si otra sesión lo cambió; 422 `servicio_con_historial`.
     */
    function eliminar(id: number, version: number, claveIdempotencia: string): Promise<Resultado<null>> {
        return resolverSinCuerpo(api.DELETE('/api/v1/servicios/{id}', {
            params: { path: { id }, query: { version }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    return { eliminable, eliminar, listar, ver, crear, editar, credenciales, ejecutar, asignaciones, cambiarEmpresa, configuracionEfectiva, activarInstalacion }
}
