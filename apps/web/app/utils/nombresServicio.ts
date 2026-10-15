import type { Schema } from '@argosisp/contracts'

type ServicioConNombres = Pick<Schema<'Servicio'>, 'cliente_id' | 'cliente_nombre' | 'plan_id' | 'plan_nombre' | 'router_id' | 'router_nombre' | 'zona_nombre'>

/**
 * Nombres que la API manda en cada `Servicio` (día 3), para no pedir el cliente, el plan o el
 * router por fila ni exigir `routers.ver` al cajero. El contrato los deja opcionales: si faltan,
 * se muestra el id.
 */
export function nombreCliente(servicio: ServicioConNombres): string {
    return servicio.cliente_nombre || `Cliente #${servicio.cliente_id}`
}

export function nombrePlan(servicio: ServicioConNombres): string {
    return servicio.plan_nombre || `Plan #${servicio.plan_id}`
}

export function nombreRouter(servicio: ServicioConNombres): string {
    return servicio.router_nombre || `Router #${servicio.router_id}`
}

/** `null` si el cliente no tiene zona. */
export function nombreZona(servicio: ServicioConNombres): string | null {
    return servicio.zona_nombre ?? null
}
