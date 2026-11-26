import type { Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, empresasDeLista, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { texto } from './comun'

type Envio = Schema<'EnvioReporte'>

/**
 * Como el filtro de `listarEnvios` (A3): los de las empresas de la petición (null = todas las que
 * tienen empresa) y los consolidados (`empresa_id` null) solo con alcance global.
 */
export function enviosVisibles(solicitud: SolicitudFixture): Envio[] {
    const empresas = empresasDeLista(solicitud)
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const consolidados = usuario?.alcance_global === true
    return bd.operacionPm.envios.filter(e => (e.empresa_id === null ? consolidados : empresas === null || empresas.includes(e.empresa_id)))
}

/**
 * Envíos programados de reportes (A3, decisión 6): lista, corridas y editar (pausar o reanudar con
 * el envío completo). Programar uno nuevo se hace desde cada reporte.
 */
export const rutasEnviosReportes: RutasFixture = {
    'GET /api/v1/reportes/envios': conPermiso('reportes.programar_envio', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const reporte = solicitud.query.get('reporte')
        const data = enviosVisibles(solicitud)
            .filter(e => activo === null || e.activo === (activo === 'true'))
            .filter(e => !reporte || e.reporte === reporte)
            .sort((a, b) => a.id - b.id)
        return { status: 200, cuerpo: { data } }
    }),

    'GET /api/v1/reportes/envios/:id/corridas': conPermiso('reportes.programar_envio', (solicitud) => {
        const envio = enviosVisibles(solicitud).find(e => e.id === idDe(solicitud))
        if (!envio) {
            return noEncontrado('el envío programado')
        }
        const limite = Number(solicitud.query.get('limit') ?? 20)
        const data = bd.operacionPm.corridasEnvios
            .filter(c => c.envio_id === envio.id)
            .sort((a, b) => b.id - a.id)
            .slice(0, Number.isInteger(limite) && limite > 0 ? limite : 20)
        return { status: 200, cuerpo: { data } }
    }),

    /**
     * Programar un envío (A3): la empresa activa o el consolidado (solo con alcance global);
     * destinatarios usuarios o correos externos aprobados y activos; frecuencia con su día (semanal 1 a
     * 7, mensual 1 a 28) y hora de Guatemala. 422 `no_compartible` si hay un correo externo y el
     * reporte lleva datos de clientes (un filtro por cliente).
     */
    'POST /api/v1/reportes/envios': conPermiso('reportes.programar_envio', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = texto(cuerpo.nombre)
        const reporte = texto(cuerpo.reporte)
        const errores: { field: string, message: string, rule: string }[] = []
        if (!nombre) {
            errores.push({ field: 'nombre', message: 'El campo nombre es obligatorio', rule: 'required' })
        }
        if (!reporte) {
            errores.push({ field: 'reporte', message: 'El campo reporte es obligatorio', rule: 'required' })
        }
        if (!['diaria', 'semanal', 'mensual'].includes(String(cuerpo.frecuencia))) {
            errores.push({ field: 'frecuencia', message: 'Elige cada cuánto', rule: 'enum' })
        }
        if (!['pdf', 'xlsx', 'csv'].includes(String(cuerpo.formato))) {
            errores.push({ field: 'formato', message: 'Elige el formato', rule: 'enum' })
        }
        if (typeof cuerpo.hora !== 'number' || cuerpo.hora < 0 || cuerpo.hora > 23) {
            errores.push({ field: 'hora', message: 'La hora va de 0 a 23', rule: 'range' })
        }
        const destinatarios = (cuerpo.destinatarios ?? {}) as { usuarios?: number[], correos_externos?: number[] }
        const usuarios = destinatarios.usuarios ?? []
        const correos = destinatarios.correos_externos ?? []
        if (usuarios.length + correos.length === 0) {
            errores.push({ field: 'destinatarios', message: 'Al menos un usuario o un correo de la lista aprobada', rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const filtros = (typeof cuerpo.filtros === 'object' && cuerpo.filtros !== null ? cuerpo.filtros : {}) as Record<string, unknown>
        if (correos.length && filtros.cliente_id !== undefined) {
            return problemaTipado(422, 'no_compartible', 'Regla de negocio', 'Este reporte lleva datos de clientes (cliente_id): no se puede enviar a un correo externo')
        }
        const consolidado = cuerpo.consolidado === true
        const empresaId = consolidado ? null : empresaActivaDe(solicitud) ?? 1
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        let siguiente = Math.max(0, ...bd.operacionPm.envios.flatMap(e => e.destinatarios.map(d => d.id))) + 1
        const momento = new Date(Date.now() + 24 * 60 * 60 * 1000)
        momento.setUTCHours(Number(cuerpo.hora) + 6, 0, 0, 0)
        const envio: Envio = {
            id: Math.max(0, ...bd.operacionPm.envios.map(e => e.id)) + 1,
            empresa_id: empresaId,
            nombre,
            reporte,
            filtros,
            formato: cuerpo.formato as Envio['formato'],
            frecuencia: cuerpo.frecuencia as Envio['frecuencia'],
            dia: cuerpo.frecuencia === 'diaria' ? null : typeof cuerpo.dia === 'number' ? cuerpo.dia : 1,
            hora: Number(cuerpo.hora),
            activo: true,
            proximo_en: momento.toISOString(),
            ultimo_envio_en: null,
            creado_por: usuario?.id ?? null,
            destinatarios: [
                ...usuarios.map((id) => {
                    const persona = Object.values(usuariosPorToken).find(u => u.id === id)
                    return { id: siguiente++, tipo: 'usuario' as const, usuario_id: id, correo_externo_id: null, nombre: persona?.nombre ?? null, correo: persona?.email ?? null, retirado: false }
                }),
                ...correos.map((id) => {
                    const correo = bd.operacionPm.correosExternos.find(c => c.id === id)
                    return { id: siguiente++, tipo: 'correo_externo' as const, usuario_id: null, correo_externo_id: id, nombre: correo?.nombre ?? null, correo: correo?.correo ?? null, retirado: correo ? !correo.activo : false }
                }),
            ],
            version: 1,
            created_at: ahora(),
            updated_at: ahora(),
        }
        bd.operacionPm.envios.push(envio)
        registrarAccion(solicitud, 'reportes.programar_envio', { tipo: 'reporte_envio', id: envio.id }, cuerpo)
        return { status: 201, cuerpo: envio }
    })),

    'PUT /api/v1/reportes/envios/:id': conPermiso('reportes.editar_envio', conIdempotencia((solicitud) => {
        const envio = enviosVisibles(solicitud).find(e => e.id === idDe(solicitud))
        if (!envio) {
            return noEncontrado('el envío programado')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = texto(cuerpo.nombre)
        if (!nombre) {
            return datosInvalidos([{ field: 'nombre', message: 'El campo nombre es obligatorio', rule: 'required' }])
        }
        if (cuerpo.version !== envio.version) {
            return versionCambiada()
        }
        const destinatarios = (cuerpo.destinatarios ?? {}) as { usuarios?: number[], correos_externos?: number[] }
        const usuarios = destinatarios.usuarios ?? []
        const correos = destinatarios.correos_externos ?? []
        if (usuarios.length + correos.length === 0) {
            return datosInvalidos([{ field: 'destinatarios', message: 'Al menos un usuario o un correo de la lista aprobada', rule: 'required' }])
        }
        const anteriores = envio.destinatarios
        let siguiente = Math.max(0, ...bd.operacionPm.envios.flatMap(e => e.destinatarios.map(d => d.id))) + 1
        const nuevos: Envio['destinatarios'] = [
            ...usuarios.map(id => anteriores.find(d => d.usuario_id === id) ?? { id: siguiente++, tipo: 'usuario' as const, usuario_id: id, correo_externo_id: null, nombre: Object.values(usuariosPorToken).find(u => u.id === id)?.nombre ?? null, correo: Object.values(usuariosPorToken).find(u => u.id === id)?.email ?? null, retirado: false }),
            ...correos.map((id) => {
                const correo = bd.operacionPm.correosExternos.find(c => c.id === id)
                return anteriores.find(d => d.correo_externo_id === id) ?? { id: siguiente++, tipo: 'correo_externo' as const, usuario_id: null, correo_externo_id: id, nombre: correo?.nombre ?? null, correo: correo?.correo ?? null, retirado: correo ? !correo.activo : false }
            }),
        ]
        Object.assign(envio, {
            nombre,
            formato: cuerpo.formato ?? envio.formato,
            frecuencia: cuerpo.frecuencia ?? envio.frecuencia,
            dia: cuerpo.dia === undefined ? envio.dia : cuerpo.dia,
            hora: typeof cuerpo.hora === 'number' ? cuerpo.hora : envio.hora,
            filtros: cuerpo.filtros ?? envio.filtros,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : envio.activo,
            destinatarios: nuevos,
            version: envio.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'reportes.editar_envio', { tipo: 'reporte_envio', id: envio.id }, cuerpo)
        return { status: 200, cuerpo: envio }
    })),
}
