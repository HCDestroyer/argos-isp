import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, idDe, noEncontrado, paginar } from '../comun'

type Tramo = Schema<'TramoAsignacion'>

/**
 * Historial de asignaciones de un servicio (`GET /servicios/:id/asignaciones`, A1), armado del
 * servicio actual: el tramo vigente (`fin: null`) desde la última edición y, para algunos, un
 * tramo anterior con otro plan e IPv4. Un servicio retirado tiene su último tramo cerrado.
 */
export function tramosDe(servicio: Schema<'Servicio'>): Tramo[] {
    const base = servicio.id * 10
    const retirado = servicio.estado === 'retirado'
    const conCambio = servicio.id % 4 === 0
    const alta = servicio.created_at
    const cambio = new Date(new Date(alta).getTime() + 20 * 86_400_000).toISOString()
    const actual: Tramo = {
        id: base + 2,
        servicio_id: servicio.id,
        router_id: servicio.router_id,
        router_nombre: servicio.router_nombre ?? null,
        plan_id: servicio.plan_id,
        plan_nombre: servicio.plan_nombre ?? null,
        ipv4: retirado ? '100.64.10.250' : servicio.ipv4,
        prefijo_enlace_v6: servicio.prefijo_enlace_v6,
        prefijo_delegado_v6: servicio.prefijo_delegado_v6,
        inicio: conCambio ? cambio : alta,
        fin: retirado ? servicio.updated_at : null,
        motivo: conCambio ? 'edicion: plan, ipv4' : 'alta',
    }
    if (!conCambio) {
        return [actual]
    }
    const planAnterior = bd.planes.find(p => p.id !== servicio.plan_id) ?? null
    return [actual, {
        ...actual,
        id: base + 1,
        plan_id: planAnterior?.id ?? null,
        plan_nombre: planAnterior?.nombre ?? null,
        ipv4: actual.ipv4 ? actual.ipv4.replace(/\.(\d+)$/, '.2$1') : null,
        inicio: alta,
        fin: cambio,
        motivo: 'alta',
    }]
}

export const rutasAsignaciones: RutasFixture = {
    'GET /api/v1/servicios/:id/asignaciones': conPermiso('servicios.ver', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        return servicio ? { status: 200, cuerpo: paginar(tramosDe(servicio), solicitud) } : noEncontrado('el servicio')
    }),
}
