import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, versionCambiada } from '../comun'

type Migracion = Schema<'MigracionAaaRouter'>

const TIPOS = ['coa', 'disconnect', 'routeros']

/** Lo que guarda `network.routers` sobre la migración; sin marcar, `version: 0`. */
function migracionDe(routerId: number): Migracion {
    const primera = bd.sesiones
        .filter(s => s.router_id === routerId)
        .reduce<string | null>((menor, s) => (menor === null || s.inicio < menor ? s.inicio : menor), null)
    return { ...(bd.migracionesAaa[routerId] ?? { router_id: routerId, aaa_desde: null, motivo: null, version: 0, updated_at: null }), primer_accounting: primera }
}

/**
 * Eventos de red (A2) y migración del router al nuevo `aaa`: `GET /red/eventos`,
 * `GET /routers/:id/migracion-aaa`, `POST /routers/:id/marcar-migrado` y
 * `GET /routers/:id/resumen-sesiones`, con las mismas reglas que la API.
 */
export const rutasRed: RutasFixture = {
    'GET /api/v1/red/eventos': conPermiso('red.ver', (solicitud) => {
        const router = numeroQuery(solicitud, 'router_id')
        const servicio = numeroQuery(solicitud, 'servicio_id')
        const tipo = solicitud.query.get('tipo')
        const resultado = solicitud.query.get('resultado')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        if (tipo && !TIPOS.includes(tipo)) {
            return datosInvalidos([{ field: 'tipo', message: 'Tipo inválido', rule: 'enum' }])
        }
        if (resultado && resultado !== 'ok' && resultado !== 'error') {
            return datosInvalidos([{ field: 'resultado', message: 'Debe ser ok o error', rule: 'enum' }])
        }
        const filas = bd.eventosRed
            .filter(e => router === undefined || e.router_id === router)
            .filter(e => servicio === undefined || e.servicio_id === servicio)
            .filter(e => !tipo || e.tipo === tipo)
            .filter(e => !resultado || e.ok === (resultado === 'ok'))
            .filter(e => !desde || e.created_at >= new Date(desde).toISOString())
            .filter(e => !hasta || e.created_at < new Date(hasta).toISOString())
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/routers/:id/migracion-aaa': conPermiso('routers.ver', (solicitud) => {
        const id = idDe(solicitud)
        return id && bd.routers.some(r => r.id === id) ? { status: 200, cuerpo: migracionDe(id) } : noEncontrado('el router')
    }),

    /** Como `MarcarRouterMigrado` (A2): motivo 3..500, `desde` no futura, `null` desmarca, 409 por versión. */
    'POST /api/v1/routers/:id/marcar-migrado': conPermiso('routers.marcar_migrado', conIdempotencia((solicitud) => {
        const id = idDe(solicitud)
        if (!id || !bd.routers.some(r => r.id === id)) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        const errores: { field: string, message: string, rule: string }[] = []
        if (motivo.length < 3 || motivo.length > 500) {
            errores.push({ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' })
        }
        const desde = cuerpo.desde === undefined ? ahora() : cuerpo.desde
        if (desde !== null && (typeof desde !== 'string' || Number.isNaN(Date.parse(desde)))) {
            errores.push({ field: 'desde', message: 'Fecha y hora inválidas', rule: 'date' })
        }
        else if (typeof desde === 'string' && Date.parse(desde) > Date.now() + 60_000) {
            errores.push({ field: 'desde', message: 'La fecha de migración no puede ser futura', rule: 'futuro' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const actual = migracionDe(id)
        if (typeof cuerpo.version === 'number' && cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const momento = ahora()
        bd.migracionesAaa[id] = {
            router_id: id,
            aaa_desde: typeof desde === 'string' ? new Date(desde).toISOString() : null,
            motivo,
            version: actual.version + 1,
            updated_at: momento,
            primer_accounting: null,
        }
        registrarAccion(solicitud, 'routers.marcar_migrado', { tipo: 'router', id }, { desde, motivo })
        return { status: 200, cuerpo: migracionDe(id) }
    })),

    /** Como `resumenSesionesRouter` (A2): PPPoE no retirados; sin `desde` usa `aaa_desde` (422 si no hay). */
    'GET /api/v1/routers/:id/resumen-sesiones': conPermiso('sesiones.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!id || !bd.routers.some(r => r.id === id)) {
            return noEncontrado('el router')
        }
        const migracion = migracionDe(id)
        const consulta = solicitud.query.get('desde')
        const desde = consulta ? new Date(consulta).toISOString() : migracion.aaa_desde
        if (!desde) {
            return datosInvalidos([{ field: 'desde', message: 'El router no tiene fecha de migración marcada: indique desde', rule: 'required' }])
        }
        const servicios = bd.servicios.filter(s => s.router_id === id && s.estado !== 'retirado' && (s.tipo_conexion ?? 'pppoe') === 'pppoe')
        const sesiones = bd.sesiones.filter(s => s.router_id === id)
        const abiertas = sesiones.filter(s => s.fin === null)
        const vivas = new Set(sesiones.filter(s => s.fin === null || s.fin >= desde).map(s => s.servicio_id))
        const sin: Schema<'ServicioSinSesion'>[] = servicios
            .filter(s => !vivas.has(s.id))
            .map((s) => {
                const ultima = sesiones.filter(x => x.servicio_id === s.id).sort((a, b) => b.inicio.localeCompare(a.inicio))[0]
                return {
                    servicio_id: s.id,
                    cliente_id: s.cliente_id,
                    cliente_nombre: s.cliente_nombre ?? '',
                    user_ppp: s.user_ppp ?? '',
                    estado: s.estado === 'limitado' || s.estado === 'suspendido' ? s.estado : 'activo',
                    ultima_sesion_inicio: ultima?.inicio ?? null,
                    ultima_sesion_fin: ultima?.fin ?? null,
                }
            })
        const resumen: Schema<'ResumenSesionesRouter'> = {
            router_id: id,
            desde,
            aaa_desde: migracion.aaa_desde,
            servicios: servicios.length,
            con_sesion_activa: servicios.filter(s => abiertas.some(a => a.servicio_id === s.id)).length,
            sesiones_activas: abiertas.length,
            con_sesion_desde: servicios.length - sin.length,
            sin_sesion_desde: sin,
        }
        return { status: 200, cuerpo: resumen }
    }),
}
