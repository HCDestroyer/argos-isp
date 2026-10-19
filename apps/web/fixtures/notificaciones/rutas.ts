import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, problemaTipado, registrarAccion } from '../comun'
import { configuracionSinFila } from './datos'

type Configuracion = Schema<'ConfiguracionNotificaciones'>

const SECRETOS = { correo: ['password'], telegram: ['token', 'webhook_secreto'] } as const

function empresaDe(solicitud: SolicitudFixture): number | null {
    const id = Number(solicitud.params.empresaId)
    return Number.isInteger(id) && id > 0 ? id : null
}

function leer(empresaId: number | null): Configuracion {
    if (empresaId === null) {
        return bd.notificaciones.global
    }
    return bd.notificaciones.empresas[empresaId] ?? configuracionSinFila(empresaId, bd.notificaciones.global)
}

function objeto(valor: unknown): Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? valor as Record<string, unknown> : {}
}

/** Como `ConfigurarNotificaciones` (A6): secretos omitidos se conservan; `***` es un 422. */
function guardar(solicitud: SolicitudFixture, empresaId: number | null): RespuestaFixture {
    if (empresaId !== null && !bd.empresas.some(e => e.id === empresaId)) {
        return datosInvalidos([{ field: 'empresaId', message: 'La empresa no existe', rule: 'exists' }])
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const actual = leer(empresaId)
    if (cuerpo.version !== actual.version) {
        return problemaTipado(409, 'conflicto_version', 'Conflicto de versión', 'La configuración fue modificada por otra sesión; recarga y vuelve a intentar')
    }
    const errores: NonNullable<Problem['errors']> = []
    for (const [canal, campos] of Object.entries(SECRETOS)) {
        const datos = objeto(cuerpo[canal])
        for (const campo of campos) {
            if (datos[campo] === '***') {
                errores.push({ field: `${canal}.${campo}`, message: 'Escribe el valor nuevo o no lo mandes para conservarlo', rule: 'secreto' })
            }
        }
    }
    const correo = objeto(cuerpo.correo)
    if (typeof correo.remitente === 'string' && correo.remitente && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.remitente)) {
        errores.push({ field: 'correo.remitente', message: 'Correo no válido', rule: 'email' })
    }
    if (typeof correo.contabilidad === 'string' && !/^\s*(?:[^\s@,]+@[^\s@,]+\.[^\s@,]+\s*(?:,\s*|$))*$/.test(correo.contabilidad)) {
        errores.push({ field: 'correo.contabilidad', message: 'El campo contabilidad no tiene un formato válido', rule: 'regex' })
    }
    if (correo.puerto !== undefined && correo.puerto !== null && (typeof correo.puerto !== 'number' || correo.puerto < 1 || correo.puerto > 65535)) {
        errores.push({ field: 'correo.puerto', message: 'Puerto entre 1 y 65535', rule: 'range' })
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const telegram = objeto(cuerpo.telegram)
    const siguiente: Configuracion = structuredClone(actual)
    const enmascarar = (valor: unknown, previo: '***' | null): '***' | null => (valor === undefined ? previo : (valor ? '***' : null))
    Object.assign(siguiente.correo, Object.fromEntries(Object.entries(correo).filter(([campo]) => campo !== 'password')))
    siguiente.correo.password = enmascarar(correo.password, actual.correo.password)
    Object.assign(siguiente.telegram, Object.fromEntries(Object.entries(telegram).filter(([campo]) => campo !== 'token' && campo !== 'webhook_secreto')))
    siguiente.telegram.token = enmascarar(telegram.token, actual.telegram.token)
    siguiente.telegram.webhook_secreto = enmascarar(telegram.webhook_secreto, actual.telegram.webhook_secreto)
    if (typeof telegram.token === 'string' && telegram.token) {
        siguiente.telegram.bot_id = telegram.token.split(':')[0] ?? null
        siguiente.telegram.webhook_ruta = `/api/v1/telegram/webhook/${siguiente.telegram.bot_id}`
    }
    if (telegram.token === null) {
        siguiente.telegram.bot_id = null
        siguiente.telegram.webhook_ruta = null
    }
    Object.assign(siguiente.avisos, objeto(cuerpo.avisos))
    const momento = ahora()
    Object.assign(siguiente, {
        id: actual.id ?? (empresaId ?? 0) + 100,
        hereda: empresaId === null ? false : (typeof cuerpo.hereda === 'boolean' ? cuerpo.hereda : actual.hereda),
        origen: 'guardada',
        version: actual.version + 1,
        created_at: actual.created_at ?? momento,
        updated_at: momento,
    })
    if (empresaId === null) {
        bd.notificaciones.global = siguiente
    }
    else {
        bd.notificaciones.empresas[empresaId] = siguiente
    }
    const entrada = structuredClone(cuerpo)
    for (const [canal, campos] of Object.entries(SECRETOS)) {
        const datos = objeto(entrada[canal])
        for (const campo of campos) {
            if (typeof datos[campo] === 'string') {
                datos[campo] = '***'
            }
        }
    }
    registrarAccion(solicitud, 'notificaciones.configurar', { tipo: 'configuracion_notificaciones', id: siguiente.id ?? 0 }, entrada)
    return { status: 200, cuerpo: siguiente }
}

/** "Enviar prueba": 200 aunque falle, con el error real del servidor (aquí, simulado por el host). */
function probar(solicitud: SolicitudFixture, empresaId: number | null): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const canal = cuerpo.canal
    if (canal !== 'correo' && canal !== 'telegram') {
        return datosInvalidos([{ field: 'canal', message: 'correo o telegram', rule: 'enum' }])
    }
    const propia = empresaId === null ? null : bd.notificaciones.empresas[empresaId]
    const usada = propia && !propia.hereda ? propia : bd.notificaciones.global
    const origen: Schema<'ResultadoPruebaCanal'>['origen'] = propia && !propia.hereda ? 'empresa' : (bd.notificaciones.global.origen === 'entorno' ? 'entorno' : 'global')
    const destino = typeof cuerpo.destino === 'string' ? cuerpo.destino.trim() : ''
    bd.enviosPrueba += 1
    const envio = 5000 + bd.enviosPrueba
    registrarAccion(solicitud, 'notificaciones.probar', { tipo: 'configuracion_notificaciones', id: usada.id ?? 0 }, { canal, destino: destino || null })
    if (canal === 'correo') {
        if (!destino) {
            return datosInvalidos([{ field: 'destino', message: 'Escribe el correo de destino', rule: 'required' }])
        }
        const error = !usada.correo.host
            ? 'No hay servidor SMTP configurado'
            : usada.correo.host.includes('falla')
                ? `getaddrinfo ENOTFOUND ${usada.correo.host}`
                : usada.correo.password === null
                    ? '535 5.7.8 Username and Password not accepted'
                    : null
        return { status: 200, cuerpo: { estado: error ? 'fallido' : 'enviado', error, destino, origen, envio_id: envio } }
    }
    const chat = destino || usada.telegram.chat_equipo || ''
    const error = usada.telegram.token === null ? '401 Unauthorized: falta el token del bot' : !chat ? '400 Bad Request: chat not found' : null
    return { status: 200, cuerpo: { estado: error ? 'fallido' : 'enviado', error, destino: chat, origen, envio_id: envio } }
}

export const rutasNotificaciones: RutasFixture = {
    'GET /api/v1/notificaciones/configuracion': conPermiso('notificaciones.ver', () => ({ status: 200, cuerpo: leer(null) })),
    'PUT /api/v1/notificaciones/configuracion': conPermiso('notificaciones.configurar', solicitud => guardar(solicitud, null)),
    'GET /api/v1/notificaciones/configuracion/empresas': conPermiso('notificaciones.ver', () => ({ status: 200, cuerpo: Object.values(bd.notificaciones.empresas) })),
    'GET /api/v1/notificaciones/configuracion/empresas/:empresaId': conPermiso('notificaciones.ver', (solicitud) => {
        const id = empresaDe(solicitud)
        return id === null ? datosInvalidos([{ field: 'empresaId', message: 'Empresa no válida', rule: 'number' }]) : { status: 200, cuerpo: leer(id) }
    }),
    'PUT /api/v1/notificaciones/configuracion/empresas/:empresaId': conPermiso('notificaciones.configurar', solicitud => guardar(solicitud, empresaDe(solicitud))),
    'POST /api/v1/notificaciones/configuracion/probar': conPermiso('notificaciones.probar', solicitud => probar(solicitud, null)),
    'POST /api/v1/notificaciones/configuracion/empresas/:empresaId/probar': conPermiso('notificaciones.probar', solicitud => probar(solicitud, empresaDe(solicitud))),
}
