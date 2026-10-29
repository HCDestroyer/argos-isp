import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from './bd'
import { conIdempotencia, conPermiso, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from './comun'

/**
 * Eliminar sin historial (`contratos/eliminar.md`, A1): `GET …/eliminable` con los motivos y
 * `DELETE …?version=N` (204). Se elimina solo lo que nunca se usó; lo demás es 422
 * `servicio_con_historial` / `router_con_historial` con los mismos motivos en `errors[]`.
 *
 * En los fixtures cuentan como historial de un servicio sus facturas, notas de crédito, promesas,
 * bonificaciones, sesiones, equipos, movimientos de inventario y de lealtad, y canjes; de un router,
 * sus servicios (también retirados), sesiones y bodegas.
 */

type Motivo = Schema<'MotivoEliminacion'>

interface Regla {
    codigo: string
    lista: () => readonly object[]
    campo: string
    singular: string
    plural: string
}

function contar(lista: readonly object[], campo: string, id: number): number {
    return lista.filter(fila => (fila as Record<string, unknown>)[campo] === id).length
}

const REGLAS_SERVICIO: Regla[] = [
    { codigo: 'facturas', lista: () => bd.facturas, campo: 'servicio_id', singular: 'factura', plural: 'facturas' },
    { codigo: 'notas_credito', lista: () => bd.notasCredito, campo: 'servicio_id', singular: 'nota de crédito', plural: 'notas de crédito' },
    { codigo: 'promesas', lista: () => bd.promesas, campo: 'servicio_id', singular: 'promesa de pago', plural: 'promesas de pago' },
    { codigo: 'bonificaciones', lista: () => bd.bonificaciones, campo: 'servicio_id', singular: 'bonificación', plural: 'bonificaciones' },
    { codigo: 'sesiones', lista: () => bd.sesiones, campo: 'servicio_id', singular: 'sesión PPPoE', plural: 'sesiones PPPoE' },
    { codigo: 'equipos', lista: () => bd.unidadesInventario, campo: 'servicio_id', singular: 'equipo', plural: 'equipos' },
    { codigo: 'inventario', lista: () => bd.movimientosInventario, campo: 'servicio_id', singular: 'movimiento de inventario', plural: 'movimientos de inventario' },
    { codigo: 'lealtad', lista: () => bd.movimientosPuntos, campo: 'servicio_id', singular: 'movimiento de puntos', plural: 'movimientos de puntos' },
    { codigo: 'canjes', lista: () => bd.canjesLealtad, campo: 'servicio_id', singular: 'canje', plural: 'canjes' },
]

const REGLAS_ROUTER: Regla[] = [
    { codigo: 'servicios', lista: () => bd.servicios, campo: 'router_id', singular: 'servicio', plural: 'servicios' },
    { codigo: 'sesiones', lista: () => bd.sesiones, campo: 'router_id', singular: 'sesión PPPoE', plural: 'sesiones PPPoE' },
    { codigo: 'bodegas', lista: () => bd.bodegas, campo: 'router_id', singular: 'bodega', plural: 'bodegas' },
]

function motivos(reglas: Regla[], id: number): Motivo[] {
    return reglas.flatMap((regla) => {
        const cantidad = contar(regla.lista(), regla.campo, id)
        return cantidad ? [{ codigo: regla.codigo, cantidad, mensaje: `tiene ${cantidad} ${cantidad === 1 ? regla.singular : regla.plural}` }] : []
    })
}

export const motivosServicio = (id: number): Motivo[] => motivos(REGLAS_SERVICIO, id)
export const motivosRouter = (id: number): Motivo[] => motivos(REGLAS_ROUTER, id)

function versionDe(solicitud: SolicitudFixture): number | null {
    const version = Number(solicitud.query.get('version'))
    return Number.isInteger(version) && version >= 0 && solicitud.query.has('version') ? version : null
}

function conHistorial(tipo: 'servicio' | 'router', id: number, lista: Motivo[]): RespuestaFixture {
    const accion = tipo === 'servicio' ? `retíralo (POST /servicios/${id}/retirar)` : 'desactívalo'
    return problemaTipado(422, `${tipo}_con_historial`, tipo === 'servicio' ? 'Servicio con historial' : 'Router con historial', `El ${tipo} ${id} tiene historial y no se puede eliminar; ${accion}`, lista.map(m => ({ field: m.codigo, message: m.mensaje, rule: 'historial' })))
}

function eliminarServicio(solicitud: SolicitudFixture): RespuestaFixture {
    const id = idDe(solicitud)
    const indice = bd.servicios.findIndex(s => s.id === id)
    const servicio = bd.servicios[indice]
    if (!servicio || id === null) {
        return noEncontrado('el servicio')
    }
    const version = versionDe(solicitud)
    if (version === null) {
        return datosInvalidos([{ field: 'version', message: 'La versión es obligatoria', rule: 'required' }])
    }
    if (version !== servicio.version) {
        return versionCambiada()
    }
    const lista = motivosServicio(id)
    if (lista.length) {
        return conHistorial('servicio', id, lista)
    }
    // La IPv4 y los prefijos salen del propio servicio: al borrarlo quedan libres.
    bd.servicios.splice(indice, 1)
    registrarAccion(solicitud, 'servicios.eliminar', { tipo: 'servicio', id }, { version })
    return { status: 204, cuerpo: undefined }
}

function eliminarRouter(solicitud: SolicitudFixture): RespuestaFixture {
    const id = idDe(solicitud)
    const indice = bd.routers.findIndex(r => r.id === id)
    const router = bd.routers[indice]
    if (!router || id === null) {
        return noEncontrado('el router')
    }
    const version = versionDe(solicitud)
    if (version === null) {
        return datosInvalidos([{ field: 'version', message: 'La versión es obligatoria', rule: 'required' }])
    }
    if (version !== router.version) {
        return versionCambiada()
    }
    const lista = motivosRouter(id)
    if (lista.length) {
        return conHistorial('router', id, lista)
    }
    const bloques = new Set(bd.ipv6Bloques.filter(b => b.router_id === id).map(b => b.id))
    bd.ipv6Pools = bd.ipv6Pools.filter(p => !bloques.has(p.bloque_id))
    bd.ipv6Bloques = bd.ipv6Bloques.filter(b => b.router_id !== id)
    bd.redesIpv4 = bd.redesIpv4.filter(r => r.router_id !== id)
    bd.implementacionesPlan = bd.implementacionesPlan.filter(i => i.router_id !== id)
    bd.routers.splice(indice, 1)
    registrarAccion(solicitud, 'routers.eliminar', { tipo: 'router', id }, { version })
    return { status: 204, cuerpo: undefined }
}

export const rutasEliminacion: RutasFixture = {
    'GET /api/v1/servicios/:id/eliminable': conPermiso('servicios.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (id === null || !bd.servicios.some(s => s.id === id)) {
            return noEncontrado('el servicio')
        }
        const lista = motivosServicio(id)
        return { status: 200, cuerpo: { eliminable: lista.length === 0, motivos: lista } satisfies Schema<'Eliminable'> }
    }),
    'GET /api/v1/routers/:id/eliminable': conPermiso('routers.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (id === null || !bd.routers.some(r => r.id === id)) {
            return noEncontrado('el router')
        }
        const lista = motivosRouter(id)
        return { status: 200, cuerpo: { eliminable: lista.length === 0, motivos: lista } satisfies Schema<'Eliminable'> }
    }),
    'DELETE /api/v1/servicios/:id': conPermiso('servicios.eliminar', conIdempotencia(eliminarServicio)),
    'DELETE /api/v1/routers/:id': conPermiso('routers.eliminar', conIdempotencia(eliminarRouter)),
}
