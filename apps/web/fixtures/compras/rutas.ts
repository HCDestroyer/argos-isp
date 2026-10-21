/**
 * `GET /compras` (A3, fase 5) con los filtros que el panel usa: `estado`, `tipo_documento`,
 * `proveedor_id`, `desde`, `hasta`; por la empresa activa y con paginación por cursor. Permiso
 * `compras.ver`, como la API.
 */
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, deLaEmpresa, numeroQuery, paginar } from '../comun'

export const rutasCompras: RutasFixture = {
    'GET /api/v1/compras': conPermiso('compras.ver', (solicitud) => {
        const { query } = solicitud
        const estado = query.get('estado')
        const tipo = query.get('tipo_documento')
        const desde = query.get('desde')
        const hasta = query.get('hasta')
        const proveedor = numeroQuery(solicitud, 'proveedor_id')
        const filas = deLaEmpresa(bd.compras, solicitud)
            .filter(c => !estado || c.estado === estado)
            .filter(c => !tipo || c.tipo_documento === tipo)
            .filter(c => proveedor === undefined || c.proveedor_id === proveedor)
            .filter(c => !desde || c.fecha_documento >= desde)
            .filter(c => !hasta || c.fecha_documento <= hasta)
            .sort((a, b) => b.fecha_documento.localeCompare(a.fecha_documento) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
