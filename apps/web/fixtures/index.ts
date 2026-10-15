/**
 * Rutas del modo fixtures del panel. Cada respuesta se tipa contra `@argosisp/contracts`
 * para que un cambio de contrato rompa el typecheck aquí y no en pantalla.
 *
 * Usuarios: `admin@argos.test` y `cajero@argos.test`, cualquier contraseña.
 * Para agregar un recurso: crea `fixtures/<recurso>/*.json` y registra su ruta abajo.
 */
import type { Problem, Schema, paths } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import loginAdmin from './auth/login.admin.json'
import loginCajero from './auth/login.cajero.json'
import login401 from './auth/login.401.json'
import meAdmin from './auth/me.admin.json'
import meCajero from './auth/me.cajero.json'

type RespuestaLogin = paths['/api/v1/auth/login']['post']['responses'][200]['content']['application/json']

const logins: Record<string, RespuestaLogin> = {
    'admin@argos.test': loginAdmin,
    'cajero@argos.test': loginCajero,
}

const usuariosPorToken: Record<string, Schema<'Me'>> = {
    [loginAdmin.token]: meAdmin,
    [loginCajero.token]: meCajero,
}

const credencialesInvalidas: Problem = login401

const sinSesion: Problem = {
    type: 'about:blank',
    title: 'Sin sesión',
    status: 401,
    detail: 'El token no es válido o expiró.',
}

function emailDe(cuerpo: unknown): string {
    if (typeof cuerpo === 'object' && cuerpo !== null && 'email' in cuerpo && typeof cuerpo.email === 'string') {
        return cuerpo.email.trim().toLowerCase()
    }
    return ''
}

export const rutasFixture: RutasFixture = {
    'POST /api/v1/auth/login': ({ cuerpo }) => {
        const respuesta = logins[emailDe(cuerpo)]
        return respuesta ? { status: 200, cuerpo: respuesta } : { status: 401, cuerpo: credencialesInvalidas }
    },

    'GET /api/v1/me': ({ token }) => {
        const usuario = token ? usuariosPorToken[token] : undefined
        return usuario ? { status: 200, cuerpo: usuario } : { status: 401, cuerpo: sinSesion }
    },
}
