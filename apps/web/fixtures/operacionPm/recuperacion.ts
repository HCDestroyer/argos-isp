import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { cuerpoObjeto, datosInvalidos, problemaTipado } from '../comun'
import { texto } from './comun'
import { FABRICA_AJUSTES } from './datos'

const LIMITE_SOLICITUDES = 5

function recuperacionEncendida(): boolean {
    return (bd.operacionPm.ajustesGlobal['auth.recuperar_contrasena'] ?? FABRICA_AJUSTES['auth.recuperar_contrasena']) === true
}

/**
 * `GET /auth/opciones`, `POST /auth/recuperar-contrasena` y `POST /auth/restablecer-contrasena`
 * (A1, `core/auth/recuperacion.ts`): públicas, sin datos de nadie; siempre 202 igual, exista o no el
 * correo; 429 `demasiadas_solicitudes`; 404 `recuperacion_apagada`; 422 `enlace_invalido`.
 */
export const rutasRecuperacion: RutasFixture = {
    'GET /api/v1/auth/opciones': () => {
        const cuerpo: Schema<'OpcionesLogin'> = {
            recuperar_contrasena: recuperacionEncendida(),
            iris: bd.iris.conector.activo && Boolean(bd.iris.conector.url_base),
            horus: bd.horus.conector.activo && Boolean(bd.horus.conector.url_base),
        }
        return { status: 200, cuerpo }
    },

    'POST /api/v1/auth/recuperar-contrasena': (solicitud) => {
        if (!recuperacionEncendida()) {
            return problemaTipado(404, 'recuperacion_apagada', 'Recuperación apagada', 'El administrador apagó la recuperación de contraseña por correo')
        }
        const email = texto(cuerpoObjeto(solicitud).email).toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
            return datosInvalidos([{ field: 'email', message: 'El campo email debe ser un correo válido', rule: 'email' }])
        }
        const pedidas = bd.operacionPm.solicitudes[email] ?? 0
        if (pedidas >= LIMITE_SOLICITUDES) {
            return problemaTipado(429, 'demasiadas_solicitudes', 'Demasiadas solicitudes', 'Espera unos minutos antes de pedir otro enlace')
        }
        bd.operacionPm.solicitudes[email] = pedidas + 1
        const cuerpo: Schema<'RecuperacionAceptada'> = { aceptada: true }
        return { status: 202, cuerpo }
    },

    'POST /api/v1/auth/restablecer-contrasena': (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const token = texto(cuerpo.token)
        const password = typeof cuerpo.password === 'string' ? cuerpo.password : ''
        if (password.length < 8 || password.length > 200) {
            return datosInvalidos([{ field: 'password', message: 'La contraseña debe tener al menos 8 caracteres', rule: 'minLength' }])
        }
        const usuarioId = bd.operacionPm.enlaces[token]
        if (!usuarioId) {
            return problemaTipado(422, 'enlace_invalido', 'Enlace inválido', 'El enlace para cambiar la contraseña no existe, ya se usó o venció: pide otro')
        }
        Reflect.deleteProperty(bd.operacionPm.enlaces, token)
        const respuesta: Schema<'ContrasenaRestablecida'> = { usuario_id: usuarioId, sesiones_cerradas: 2 }
        return { status: 200, cuerpo: respuesta }
    },
}
