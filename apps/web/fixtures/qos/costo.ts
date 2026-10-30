import type { Schema } from '@argosisp/contracts'
import type { ClaseQosFixture } from './datos'
import { bd } from '../bd'

/**
 * Perfil de QoS efectivo de un router (`perfilEfectivoId` de A2): el suyo o el predeterminado, y sus
 * clases activas. Lo usan el control de velocidad (regla 11, costo) y las rutas de QoS.
 */
export function perfilEfectivoId(router: Pick<Schema<'Router'>, 'qos_perfil_id'>): number | null {
    return router.qos_perfil_id ?? bd.qosPerfiles.find(p => p.predeterminado)?.id ?? null
}

export function clasesActivasDeRouter(router: Pick<Schema<'Router'>, 'qos_perfil_id'>): ClaseQosFixture[] {
    const id = perfilEfectivoId(router)
    return id === null ? [] : bd.qosClases.filter(c => c.perfil_id === id && c.activa)
}
