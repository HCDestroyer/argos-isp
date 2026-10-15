import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, numeroQuery, paginar } from '../comun'

export const rutasBitacora: RutasFixture = {
    'GET /api/v1/bitacora/acciones': conPermiso('bitacora.ver', (solicitud) => {
        const tipo = solicitud.query.get('entidad_tipo')
        const entidad = numeroQuery(solicitud, 'entidad_id')
        const actor = numeroQuery(solicitud, 'actor_id')
        const accion = solicitud.query.get('accion')
        const filas = bd.acciones
            .filter(a => !tipo || a.entidad_tipo === tipo)
            .filter(a => entidad === undefined || a.entidad_id === entidad)
            .filter(a => actor === undefined || a.actor_id === actor)
            .filter(a => !accion || a.accion === accion)
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
