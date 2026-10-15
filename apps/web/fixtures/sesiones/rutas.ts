import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, numeroQuery, paginar } from '../comun'

export const rutasSesiones: RutasFixture = {
    'GET /api/v1/sesiones': conPermiso('sesiones.ver', (solicitud) => {
        const servicio = numeroQuery(solicitud, 'servicio_id')
        const router = numeroQuery(solicitud, 'router_id')
        const activa = solicitud.query.get('activa')
        const filas = bd.sesiones
            .filter(s => servicio === undefined || s.servicio_id === servicio)
            .filter(s => router === undefined || s.router_id === router)
            .filter(s => activa === null || (activa === 'true') === (s.fin === null))
            .sort((a, b) => b.inicio.localeCompare(a.inicio) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
