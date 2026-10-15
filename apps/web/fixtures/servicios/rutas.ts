import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, idDe, noEncontrado, normalizar, numeroQuery, paginar } from '../comun'

export const rutasServicios: RutasFixture = {
    'GET /api/v1/servicios': conPermiso('servicios.ver', (solicitud) => {
        const q = normalizar(solicitud.query.get('q')?.trim())
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const router = numeroQuery(solicitud, 'router_id')
        const plan = numeroQuery(solicitud, 'plan_id')
        const estado = solicitud.query.get('estado')
        const filas = bd.servicios
            .filter(s => cliente === undefined || s.cliente_id === cliente)
            .filter(s => router === undefined || s.router_id === router)
            .filter(s => plan === undefined || s.plan_id === plan)
            .filter(s => !estado || s.estado === estado)
            .filter((s) => {
                if (!q) {
                    return true
                }
                const nombre = bd.clientes.find(c => c.id === s.cliente_id)?.nombre
                return normalizar(s.user_ppp).includes(q) || s.ipv4 === q || normalizar(nombre).includes(q)
            })
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/servicios/:id': conPermiso('servicios.ver', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        return servicio ? { status: 200, cuerpo: servicio } : noEncontrado('el servicio')
    }),
}
