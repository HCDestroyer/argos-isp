import type { Schema } from '@argosisp/contracts'

export type GestionEquipo = Schema<'GestionEquipo'>
export type EstadoEquipoVivo = Schema<'EstadoEquipo'>

/**
 * El equipo del cliente gestionado por SmartOLT y el ACS (ficha del servicio › Equipo): qué cuenta y
 * qué OLT usa (`GET /servicios/:id/equipo/gestion`, solo lee Argos) y su estado en vivo
 * (`GET /servicios/:id/equipo`, lee SmartOLT y el ACS). Los dos con `servicios.ver_equipo`.
 */
export function useEquipoGestionado() {
    const api = useApi()

    function gestion(servicioId: number): Promise<Resultado<GestionEquipo>> {
        return resolver(api.GET('/api/v1/servicios/{id}/equipo/gestion', { params: { path: { id: servicioId } } }))
    }

    function estado(servicioId: number): Promise<Resultado<EstadoEquipoVivo>> {
        return resolver(api.GET('/api/v1/servicios/{id}/equipo', { params: { path: { id: servicioId } } }))
    }

    return { gestion, estado }
}
