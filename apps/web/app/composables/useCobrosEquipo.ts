import type { Schema, paths } from '@argosisp/contracts'

export type CobroEquipo = Schema<'CobroEquipo'>
export type PendienteNoRecuperado = Schema<'PendienteNoRecuperado'>
export type EstadoCobroEquipo = CobroEquipo['estado']
export type DatosAprobarCobroEquipo = paths['/api/v1/inventario/cobros-equipo/{id}/aprobar']['post']['requestBody']['content']['application/json']

/**
 * Cobros de equipo (A48): la cola de «Equipo no devuelto» y de los cobros propuestos desde un cambio
 * de equipo, y los equipos con intentos que esperan que una persona los declare no recuperados.
 * Aprobar o rechazar lo decide quien tiene `inventario.cobrar_equipo`; el técnico solo propone.
 */
export function useCobrosEquipo() {
    const api = useApi()

    /** `GET /inventario/cobros-equipo?estado=`: la cola, del más reciente al más viejo. */
    function listar(estado: EstadoCobroEquipo | null, cursor?: string): Promise<Resultado<Pagina<CobroEquipo>>> {
        return resolver(api.GET('/api/v1/inventario/cobros-equipo', { params: { query: { limit: 50, ...(estado ? { estado } : {}), ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /inventario/cobros-equipo/pendientes-declarar`: intentos, técnicos distintos y contactos de cada equipo. */
    function pendientesDeclarar(): Promise<Resultado<PendienteNoRecuperado[]>> {
        return resolver(api.GET('/api/v1/inventario/cobros-equipo/pendientes-declarar', { params: { query: { limit: 100 } } }))
    }

    /** `POST /inventario/cobros-equipo/:id/aprobar`: cargo único al cliente por el monto aprobado. */
    function aprobar(cobro: Pick<CobroEquipo, 'id' | 'version'>, datos: Omit<DatosAprobarCobroEquipo, 'version'>, clave: string): Promise<Resultado<CobroEquipo>> {
        return resolver(api.POST('/api/v1/inventario/cobros-equipo/{id}/aprobar', {
            params: { path: { id: cobro.id }, header: { 'Idempotency-Key': clave } },
            body: { ...datos, version: cobro.version },
        }))
    }

    /** `POST /inventario/cobros-equipo/:id/rechazar`: sin cobro, con motivo. */
    function rechazar(cobro: Pick<CobroEquipo, 'id' | 'version'>, motivo: string, clave: string): Promise<Resultado<CobroEquipo>> {
        return resolver(api.POST('/api/v1/inventario/cobros-equipo/{id}/rechazar', {
            params: { path: { id: cobro.id }, header: { 'Idempotency-Key': clave } },
            body: { version: cobro.version, motivo },
        }))
    }

    return { listar, pendientesDeclarar, aprobar, rechazar }
}
