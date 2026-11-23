import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, usuariosPorToken } from '../comun'
import { texto } from './comun'

/**
 * Correos externos aprobados para los reportes contables programados (A3, decisión 6): aprobar
 * (reactiva uno retirado; si está activo solo cambia el nombre) y retirar (no se borra).
 */
export const rutasCorreosExternos: RutasFixture = {
    'GET /api/v1/reportes/correos-externos': conPermiso('reportes.programar_envio', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const nombre = (id: number | null) => (id === null ? null : Object.values(usuariosPorToken).find(u => u.id === id)?.nombre ?? null)
        const data: Schema<'CorreoExternoReportesListado'>[] = bd.operacionPm.correosExternos
            .filter(c => activo === null || c.activo === (activo === 'true'))
            // Los envíos programados del fixture no guardan destinatarios externos: 0 hasta que los tengan.
            .map(c => ({ ...c, aprobado_por_nombre: nombre(c.aprobado_por), retirado_por_nombre: nombre(c.retirado_por), envios_programados: 0, envios_activos: 0 }))
        return { status: 200, cuerpo: { data } }
    }),

    'POST /api/v1/reportes/correos-externos': conPermiso('reportes.aprobar_correo_externo', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const correo = texto(cuerpo.correo).toLowerCase()
        const nombre = texto(cuerpo.nombre)
        const errores: NonNullable<Parameters<typeof datosInvalidos>[0]> = []
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 254) {
            errores.push({ field: 'correo', message: 'El campo correo debe ser un correo válido', rule: 'email' })
        }
        if (nombre.length < 1 || nombre.length > 120) {
            errores.push({ field: 'nombre', message: 'El campo nombre es obligatorio', rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const quien = solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null
        const existente = bd.operacionPm.correosExternos.find(c => c.correo === correo)
        if (existente) {
            Object.assign(existente, existente.activo
                ? { nombre, version: existente.version + 1 }
                : { nombre, activo: true, aprobado_por: quien, aprobado_en: ahora(), retirado_por: null, retirado_en: null, version: existente.version + 1 })
            registrarAccion(solicitud, 'reportes.aprobar_correo_externo', { tipo: 'correo_externo_reportes', id: existente.id }, cuerpo)
            return { status: 201, cuerpo: existente }
        }
        const nuevo: Schema<'CorreoExternoReportes'> = { id: siguienteId(bd.operacionPm.correosExternos), correo, nombre, activo: true, aprobado_por: quien, aprobado_en: ahora(), retirado_por: null, retirado_en: null, version: 1 }
        bd.operacionPm.correosExternos.unshift(nuevo)
        registrarAccion(solicitud, 'reportes.aprobar_correo_externo', { tipo: 'correo_externo_reportes', id: nuevo.id }, cuerpo)
        return { status: 201, cuerpo: nuevo }
    })),

    'POST /api/v1/reportes/correos-externos/:id/retirar': conPermiso('reportes.retirar_correo_externo', conIdempotencia((solicitud) => {
        const correo = bd.operacionPm.correosExternos.find(c => c.id === idDe(solicitud))
        if (!correo) {
            return noEncontrado('el correo')
        }
        if (correo.activo) {
            Object.assign(correo, { activo: false, retirado_por: solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null, retirado_en: ahora(), version: correo.version + 1 })
            registrarAccion(solicitud, 'reportes.retirar_correo_externo', { tipo: 'correo_externo_reportes', id: correo.id }, {})
        }
        return { status: 200, cuerpo: correo }
    })),
}
