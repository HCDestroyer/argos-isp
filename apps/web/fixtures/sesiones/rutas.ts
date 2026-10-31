import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, numeroQuery, paginar } from '../comun'
import { nuevaSesion } from './datos'

/**
 * Como el cron `sesiones_ppp` (`sesiones.sondear_ppp`, `contratos/pppoe-local.md` §6) en un router sin
 * RADIUS con credenciales de la API: cada PPPoE activo, limitado o suspendido que no tiene sesión
 * abierta aparece conectado en `/ppp/active` (el CPE vuelve a marcar solo) y se abre su sesión de
 * sondeo, sin consumo. Corre al leer las sesiones, como si el sondeo acabara de pasar.
 */
function sondearPpp(): void {
    for (const router of bd.routers) {
        if (router.modo_seguridad !== 'api' || !router.activo || !router.api_usuario || !router.tiene_api_password) {
            continue
        }
        for (const servicio of bd.servicios) {
            if (servicio.router_id !== router.id || (servicio.tipo_conexion ?? 'pppoe') !== 'pppoe') {
                continue
            }
            if (!['activo', 'limitado', 'suspendido'].includes(servicio.estado)) {
                continue
            }
            if (bd.sesiones.some(s => s.servicio_id === servicio.id && s.fin === null)) {
                continue
            }
            bd.sesiones.push(nuevaSesion(siguienteId(bd.sesiones), servicio, ahora(), router))
        }
    }
}

export const rutasSesiones: RutasFixture = {
    'GET /api/v1/sesiones': conPermiso('sesiones.ver', (solicitud) => {
        sondearPpp()
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
