/**
 * Rutas del modo fixtures del panel. Cada respuesta se tipa contra `@argosisp/contracts`
 * para que un cambio de contrato rompa el typecheck aquí y no en pantalla.
 *
 * Usuarios: `admin@argos.test` y `cajero@argos.test`, cualquier contraseña.
 * Para agregar un recurso: crea `fixtures/<recurso>/datos.ts` (tipado con `Schema<'X'>`),
 * sus rutas en `fixtures/<recurso>/rutas.ts` y regístralas abajo. Los datos mutables viven
 * en `bd.ts` (`reiniciarFixtures()` en pruebas).
 */
import type { Problem, Schema, paths } from '@argosisp/contracts'
import type { ManejadorFixture, RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from './bd'
import loginAdmin from './auth/login.admin.json'
import loginCajero from './auth/login.cajero.json'
import login401 from './auth/login.401.json'
import { rutasBancos } from './bancos/rutas'
import { rutasBitacora } from './bitacora/rutas'
import { rutasCajas } from './cajas/rutas'
import { rutasClientes } from './clientes/rutas'
import { rutasComprobantes } from './comprobantes/rutas'
import { rutasDocumentos } from './documentos/rutas'
import { rutasEgresos } from './egresos/rutas'
import { rutasFacturacion } from './facturacion/rutas'
import { rutasLibro } from './libro/rutas'
import { sinSesion, usuariosPorToken } from './comun'
import { rutasPlanes } from './planes/rutas'
import { rutasPlantillas } from './plantillas/rutas'
import { rutasPromesas } from './promesas/rutas'
import { rutasRed } from './red/rutas'
import { rutasSimulador } from './promesas/simulador'
import { rutasReportes } from './reportes/rutas'
import { rutasRouters } from './routers/rutas'
import { rutasAsignaciones } from './servicios/asignaciones'
import { rutasServicios } from './servicios/rutas'
import { rutasSesiones } from './sesiones/rutas'
import { rutasUsuarios } from './usuarios/rutas'
import { rutasZonas } from './zonas/rutas'

export { reiniciarFixtures } from './bd'

type RespuestaLogin = paths['/api/v1/auth/login']['post']['responses'][200]['content']['application/json']

const logins: Record<string, RespuestaLogin> = {
    'admin@argos.test': loginAdmin,
    'cajero@argos.test': loginCajero,
}

const credencialesInvalidas: Problem = login401

function emailDe(cuerpo: unknown): string {
    if (typeof cuerpo === 'object' && cuerpo !== null && 'email' in cuerpo && typeof cuerpo.email === 'string') {
        return cuerpo.email.trim().toLowerCase()
    }
    return ''
}

/**
 * Solo en el navegador en modo fixtures (no en Vitest): la cookie simulada sobrevive a recargar la
 * página, como la de verdad. Es una simulación de desarrollo; con la API real el token vive en la
 * cookie `HttpOnly` y el panel no lo ve.
 */
const CLAVE_COOKIE_SIMULADA = 'argos_fixtures_cookie_sesion'
const persistir = typeof window !== 'undefined' && !import.meta.test
let restaurada = false

function guardarCookieSimulada(): void {
    if (!persistir) {
        return
    }
    try {
        globalThis.sessionStorage?.setItem(CLAVE_COOKIE_SIMULADA, JSON.stringify(bd.sesion))
    }
    catch {
        // Sin sessionStorage: la sesión simulada dura hasta recargar.
    }
}

function restaurarCookieSimulada(): void {
    if (restaurada || !persistir) {
        return
    }
    restaurada = true
    try {
        const valor: unknown = JSON.parse(globalThis.sessionStorage?.getItem(CLAVE_COOKIE_SIMULADA) ?? 'null')
        if (typeof valor === 'object' && valor !== null && 'token' in valor && 'csrf' in valor
            && (typeof valor.token === 'string' || valor.token === null) && (typeof valor.csrf === 'string' || valor.csrf === null)) {
            bd.sesion = { token: valor.token, csrf: valor.csrf }
        }
    }
    catch {
        // Valor dañado: sin sesión.
    }
}

/** La cookie `argos_sesion` simulada que manda el navegador (`credentials: 'include'`). */
export function cookieSesionFixture(): string | null {
    restaurarCookieSimulada()
    return bd.sesion.token
}

/**
 * Para pruebas: deja una sesión del panel (como si la API hubiera puesto la cookie) con el token
 * de un usuario de los fixtures (`fixture-admin`, `fixture-cajero`), o la quita con `null`. No
 * comprueba CSRF; el flujo con `POST /auth/sesion` sí lo comprueba.
 */
export function sesionFixture(token: string | null): void {
    bd.sesion = { token, csrf: null }
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Como `sesion_panel.ts` (A1): con la cookie, POST/PUT/DELETE llevan el `X-CSRF-Token` de la sesión. */
function csrfInvalido(solicitud: SolicitudFixture, clave: string): boolean {
    return solicitud.porCookie
        && clave !== 'POST /api/v1/auth/sesion'
        && !METODOS_SEGUROS.has(solicitud.metodo)
        && bd.sesion.csrf !== null
        && solicitud.headers.get('X-CSRF-Token') !== bd.sesion.csrf
}

const PROBLEMA_CSRF: Problem = {
    type: 'urn:argosisp:problema:csrf_invalido',
    title: 'CSRF inválido',
    status: 403,
    detail: 'Falta o no coincide la cabecera X-CSRF-Token de la sesión del panel.',
}

/** Clave de `localStorage` con fallas simuladas para Playwright: `{"GET /api/v1/pagos": 501}`. */
export const CLAVE_FALLAS = 'argos_fixtures_fallas'

/**
 * Hace que una ruta responda `status` con el mismo Problem que la API real (`NoImplementado`
 * para 501). Sirve para probar que la pantalla muestra el error y no datos inventados.
 */
export function simularFalla(ruta: string, status = 501): void {
    bd.fallas[ruta] = status
}

function fallasGuardadas(): Record<string, number> {
    try {
        const texto = globalThis.localStorage?.getItem(CLAVE_FALLAS)
        const valor: unknown = texto ? JSON.parse(texto) : null
        if (typeof valor !== 'object' || valor === null) {
            return {}
        }
        return Object.fromEntries(Object.entries(valor).filter((par): par is [string, number] => typeof par[1] === 'number'))
    }
    catch {
        return {}
    }
}

function respuestaFalla(ruta: string, status: number): RespuestaFixture {
    const cuerpo: Problem = status === 501
        ? { type: 'urn:argosisp:problema:no_implementado', title: 'No implementado', status, detail: `La operación ${ruta} aún no está implementada` }
        : { type: 'urn:argosisp:problema:error_interno', title: 'Error interno', status, detail: `Falla simulada en ${ruta}` }
    return { status, cuerpo }
}

function conFallasSimuladas(rutas: RutasFixture): RutasFixture {
    return Object.fromEntries(Object.entries(rutas).map(([clave, manejador]): [string, ManejadorFixture] => [
        clave,
        (solicitud) => {
            const status = bd.fallas[clave] ?? fallasGuardadas()[clave]
            if (status) {
                return respuestaFalla(clave, status)
            }
            return csrfInvalido(solicitud, clave) ? { status: 403, cuerpo: PROBLEMA_CSRF } : manejador(solicitud)
        },
    ]))
}

export const rutasFixture: RutasFixture = conFallasSimuladas({
    'POST /api/v1/auth/login': ({ cuerpo }) => {
        const respuesta = logins[emailDe(cuerpo)]
        return respuesta ? { status: 200, cuerpo: respuesta } : { status: 401, cuerpo: credencialesInvalidas }
    },

    /**
     * Como `POST /auth/sesion` (A1, `contratos/sesion-panel.md`): mismas credenciales que el login,
     * pero el token va a la cookie `argos_sesion` (aquí, `bd.sesion`) y el cuerpo trae el `csrf`.
     */
    'POST /api/v1/auth/sesion': ({ cuerpo }) => {
        const respuesta = logins[emailDe(cuerpo)]
        if (!respuesta) {
            return { status: 401, cuerpo: credencialesInvalidas }
        }
        const csrf = `csrf-${respuesta.token}-${Date.now().toString(36)}`
        bd.sesion = { token: respuesta.token, csrf }
        guardarCookieSimulada()
        const sesion: Schema<'SesionPanel'> = {
            usuario: { ...respuesta.usuario, csrf },
            csrf,
            expira_en: new Date(Date.now() + 12 * 3_600_000).toISOString(),
        }
        return { status: 200, cuerpo: sesion }
    },

    /** Como `POST /auth/logout`: revoca el token, borra la cookie y responde 204; sin sesión, 401. */
    'POST /api/v1/auth/logout': ({ token, porCookie }) => {
        if (!token || !usuariosPorToken[token]) {
            return sinSesion()
        }
        bd.sesionesCerradas.push(token)
        if (porCookie) {
            bd.sesion = { token: null, csrf: null }
            guardarCookieSimulada()
        }
        return { status: 204, cuerpo: undefined }
    },

    /** Con la cookie, `Me` trae el `csrf` (así el panel lo recupera tras recargar). */
    'GET /api/v1/me': ({ token, porCookie }) => {
        const usuario = token ? usuariosPorToken[token] : undefined
        if (!usuario) {
            return sinSesion()
        }
        return { status: 200, cuerpo: porCookie && bd.sesion.csrf ? { ...usuario, csrf: bd.sesion.csrf } : usuario }
    },

    ...rutasZonas,
    ...rutasClientes,
    ...rutasServicios,
    ...rutasAsignaciones,
    ...rutasRouters,
    ...rutasRed,
    ...rutasPlanes,
    ...rutasPlantillas,
    ...rutasBitacora,
    ...rutasSesiones,
    ...rutasFacturacion,
    ...rutasLibro,
    ...rutasCajas,
    ...rutasComprobantes,
    ...rutasSimulador,
    ...rutasPromesas,
    ...rutasUsuarios,
    ...rutasBancos,
    ...rutasDocumentos,
    ...rutasReportes,
    ...rutasEgresos,
})
