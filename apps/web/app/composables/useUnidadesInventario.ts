import type { Schema, paths } from '@argosisp/contracts'

export type UnidadInventario = Schema<'UnidadInventario'>
export type UnidadInventarioHistorial = Schema<'UnidadInventarioHistorial'>
export type UnidadInventarioDetalle = Schema<'UnidadInventarioDetalle'>
export type UnidadNoRecuperada = Schema<'UnidadNoRecuperada'>
export type ContactoRecuperacion = Schema<'ContactoRecuperacion'>
export type EstadoUnidadInventario = UnidadInventario['estado']
export type EstadoEquipoInventario = UnidadInventario['estado_equipo']
export type FiltrosUnidades = Omit<NonNullable<paths['/api/v1/inventario/unidades']['get']['parameters']['query']>, 'cursor'>
export type DatosEnviarGarantia = paths['/api/v1/inventario/unidades/{id}/enviar-garantia']['post']['requestBody']['content']['application/json']
export type DatosResolverGarantia = paths['/api/v1/inventario/unidades/{id}/resolver-garantia']['post']['requestBody']['content']['application/json']
export type DatosContactoRecuperacion = paths['/api/v1/inventario/unidades/{id}/contactos-recuperacion']['post']['requestBody']['content']['application/json']
export type DatosNoRecuperada = paths['/api/v1/inventario/unidades/{id}/declarar-no-recuperada']['post']['requestBody']['content']['application/json']

/**
 * Equipos por serie o MAC (A3 y A48): búsqueda, detalle con el historial de su estado, revisión y
 * garantía, contactos de recuperación y la declaración de no recuperado (la decide una persona con
 * `inventario.cobrar_equipo`, nunca el técnico).
 */
export function useUnidadesInventario() {
    const api = useApi()

    /** `GET /inventario/unidades`: `q` busca la serie («contiene») y la MAC con o sin separadores. */
    function listar(filtros: FiltrosUnidades = {}, cursor?: string): Promise<Resultado<Pagina<UnidadInventario>>> {
        const query: FiltrosUnidades & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/inventario/unidades', { params: { query } }))
    }

    /** `GET /inventario/unidades/:id`: kardex, historial de estados, garantías, intentos y contactos. */
    function ver(id: number): Promise<Resultado<UnidadInventarioDetalle>> {
        return resolver(api.GET('/api/v1/inventario/unidades/{id}', { params: { path: { id } } }))
    }

    /** `POST /inventario/unidades/:id/marcar-reparada` (`inventario.marcar_reparada`): de revisión a disponible. */
    function marcarReparada(id: number, motivo: string): Promise<Resultado<UnidadInventario>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/marcar-reparada', { params: { path: { id } }, body: { motivo } }))
    }

    /** `POST /inventario/unidades/:id/enviar-garantia` (`inventario.enviar_garantia`): proveedor, RMA y vencimiento. */
    function enviarGarantia(id: number, datos: DatosEnviarGarantia): Promise<Resultado<UnidadInventario>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/enviar-garantia', { params: { path: { id } }, body: datos }))
    }

    /** `POST /inventario/unidades/:id/resolver-garantia` (`inventario.resolver_garantia`): reparada, reemplazada o rechazada. */
    function resolverGarantia(id: number, datos: DatosResolverGarantia): Promise<Resultado<UnidadInventario>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/resolver-garantia', { params: { path: { id } }, body: datos }))
    }

    /** `POST /inventario/unidades/:id/contactos-recuperacion` (`inventario.registrar_contacto_recuperacion`). */
    function registrarContacto(id: number, datos: DatosContactoRecuperacion): Promise<Resultado<ContactoRecuperacion>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/contactos-recuperacion', { params: { path: { id } }, body: datos }))
    }

    /**
     * `POST /inventario/unidades/:id/declarar-no-recuperada` (`inventario.cobrar_equipo`): baja a pérdida y,
     * con monto, el cargo «Equipo no devuelto». 422 `intentos_insuficientes` sin los intentos o el contacto.
     */
    function declararNoRecuperada(id: number, datos: DatosNoRecuperada, clave: string): Promise<Resultado<UnidadNoRecuperada>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/declarar-no-recuperada', { params: { path: { id }, header: { 'Idempotency-Key': clave } }, body: datos }))
    }

    return { listar, ver, marcarReparada, enviarGarantia, resolverGarantia, registrarContacto, declararNoRecuperada }
}
