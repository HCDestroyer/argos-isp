import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, paginar } from '../comun'

export const rutasRouters: RutasFixture = {
    'GET /api/v1/routers': conPermiso('routers.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const filas = bd.routers.filter(router => activo === null || String(router.activo) === activo)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
