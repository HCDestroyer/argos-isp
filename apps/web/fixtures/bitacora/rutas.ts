import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, numeroQuery, paginar } from '../comun'

/** Como `listarAcciones` de la API: el cliente y sus servicios, facturas, pagos y promesas. */
function delCliente(accion: Schema<'AccionAuditoria'>, clienteId: number): boolean {
    const id = accion.entidad_id
    switch (accion.entidad_tipo) {
        case 'cliente':
            return id === clienteId
        case 'servicio':
            return bd.servicios.some(s => s.id === id && s.cliente_id === clienteId)
        case 'factura':
            return bd.facturas.some(f => f.id === id && f.cliente_id === clienteId)
        case 'pago':
            return bd.pagos.some(p => p.id === id && p.cliente_id === clienteId)
        case 'promesa':
            return bd.promesas.some(p => p.id === id && p.cliente_id === clienteId)
        default:
            return false
    }
}

export const rutasBitacora: RutasFixture = {
    'GET /api/v1/bitacora/acciones': conPermiso('bitacora.ver', (solicitud) => {
        const tipo = solicitud.query.get('entidad_tipo')
        const entidad = numeroQuery(solicitud, 'entidad_id')
        const actor = numeroQuery(solicitud, 'actor_id')
        const accion = solicitud.query.get('accion')
        const canal = solicitud.query.get('canal')
        const excluirCanal = solicitud.query.get('excluir_canal')
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const requestId = solicitud.query.get('request_id')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        const filas = bd.acciones
            .filter(a => !canal || a.canal === canal)
            .filter(a => !excluirCanal || a.canal !== excluirCanal)
            .filter(a => cliente === undefined || delCliente(a, cliente))
            .filter(a => !tipo || a.entidad_tipo === tipo)
            .filter(a => entidad === undefined || a.entidad_id === entidad)
            .filter(a => actor === undefined || a.actor_id === actor)
            .filter(a => !accion || a.accion === accion)
            .filter(a => !requestId || a.request_id === requestId)
            .filter(a => !desde || new Date(a.created_at) >= new Date(desde))
            .filter(a => !hasta || new Date(a.created_at) <= new Date(hasta))
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/bitacora/cambios': conPermiso('bitacora.ver', (solicitud) => {
        const tipo = solicitud.query.get('entidad_tipo')
        const entidad = numeroQuery(solicitud, 'entidad_id')
        const requestId = solicitud.query.get('request_id')
        const filas = bd.cambios
            .filter(c => !tipo || c.entidad_tipo === tipo)
            .filter(c => entidad === undefined || c.entidad_id === entidad)
            .filter(c => !requestId || c.request_id === requestId)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
