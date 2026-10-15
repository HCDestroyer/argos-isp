import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, numeroQuery, paginar } from '../comun'

export const rutasPlanes: RutasFixture = {
    'GET /api/v1/planes': conPermiso('planes.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const router = numeroQuery(solicitud, 'router_id')
        const filas = bd.planes
            .filter(plan => activo === null || String(plan.activo) === activo)
            .filter(plan => router === undefined || (bd.planesPorRouter[router] ?? []).includes(plan.id))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
