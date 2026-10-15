import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, idDe, noEncontrado, paginar } from '../comun'

function existeRouter(id: number | null): boolean {
    return bd.routers.some(router => router.id === id)
}

export const rutasRouters: RutasFixture = {
    'GET /api/v1/routers': conPermiso('routers.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const filas = bd.routers.filter(router => activo === null || String(router.activo) === activo)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/routers/:id/planes': conPermiso('planes.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!existeRouter(id)) {
            return noEncontrado('el router')
        }
        const implementados = bd.planesPorRouter[id ?? 0] ?? []
        return { status: 200, cuerpo: bd.planes.filter(plan => implementados.includes(plan.id)) }
    }),

    'GET /api/v1/routers/:id/redes-ipv4': conPermiso('redes.ver', (solicitud) => {
        const id = idDe(solicitud)
        return existeRouter(id)
            ? { status: 200, cuerpo: bd.redesIpv4.filter(red => red.router_id === id) }
            : noEncontrado('el router')
    }),

    'GET /api/v1/routers/:id/ipv6-bloques': conPermiso('ipv6.ver', (solicitud) => {
        const id = idDe(solicitud)
        return existeRouter(id)
            ? { status: 200, cuerpo: bd.ipv6Bloques.filter(bloque => bloque.router_id === id) }
            : noEncontrado('el router')
    }),
}
