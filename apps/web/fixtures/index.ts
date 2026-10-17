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
import { rutasEmpresas } from './empresas/rutas'
import { rutasNotificaciones } from './notificaciones/rutas'
import { rutasFacturacion } from './facturacion/rutas'
import { rutasEstadosFinancieros } from './libro/estados'
import { rutasLibro } from './libro/rutas'
import { empresaActivaDe, empresaNoPermitida, sinSesion, usuariosPorToken } from './comun'
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

function passwordDe(cuerpo: unknown): string {
    return typeof cuerpo === 'object' && cuerpo !== null && 'password' in cuerpo && typeof cuerpo.password === 'string' ? cuerpo.password : ''
}

/**
 * Contraseña que los fixtures rechazan (cualquier otra entra). Tras `LIMITE_FALLIDOS` fallos
 * seguidos con la misma cuenta responde 429 con `Retry-After`, como `limite_login.ts` de A1.
 */
export const PASSWORD_INCORRECTA_FIXTURE = 'incorrecta'
const LIMITE_FALLIDOS = 5
const VENTANA_LIMITE_S = 900

const DEMASIADOS_INTENTOS: Problem = {
    type: 'urn:argosisp:problema:demasiados_intentos',
    title: 'Demasiados intentos de inicio de sesión',
    status: 429,
    detail: `Demasiados intentos fallidos con esta cuenta; intenta de nuevo en ${VENTANA_LIMITE_S} s`,
}

/** Credenciales del login de los fixtures: la respuesta, o el 401/429 que daría la API. */
function revisarCredenciales(cuerpo: unknown): { ok: true, respuesta: RespuestaLogin } | { ok: false, falla: RespuestaFixture } {
    const email = emailDe(cuerpo)
    const fallidos = bd.loginFallidos[email] ?? 0
    if (fallidos >= LIMITE_FALLIDOS) {
        return { ok: false, falla: { status: 429, cuerpo: DEMASIADOS_INTENTOS, headers: { 'Retry-After': String(VENTANA_LIMITE_S) } } }
    }
    const respuesta = logins[email]
    if (!respuesta || passwordDe(cuerpo) === PASSWORD_INCORRECTA_FIXTURE) {
        bd.loginFallidos[email] = fallidos + 1
        return { ok: false, falla: { status: 401, cuerpo: credencialesInvalidas } }
    }
    bd.loginFallidos[email] = 0
    return { ok: true, respuesta }
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
            const expiraEn = 'expiraEn' in valor && typeof valor.expiraEn === 'string' ? valor.expiraEn : null
            const expiraMaxEn = 'expiraMaxEn' in valor && typeof valor.expiraMaxEn === 'string' ? valor.expiraMaxEn : null
            bd.sesion = { token: valor.token, csrf: valor.csrf, expiraEn, expiraMaxEn }
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
    bd.sesion = { token, csrf: null, expiraEn: null, expiraMaxEn: null }
}

/** Como `PANEL_SESION_INACTIVIDAD_H` y `PANEL_SESION_MAXIMA_H` de la API (12 h y 72 h). */
const SESION_INACTIVIDAD_MS = 12 * 3_600_000
const SESION_MAXIMA_MS = 72 * 3_600_000

/**
 * Para pruebas: mueve los vencimientos de la sesión simulada. `expiraMaxEn` en el pasado hace
 * que la siguiente petición con la cookie responda 401 `sesion_expirada`, como la API.
 */
export function vencimientosSesionFixture(expiraEn: string | null, expiraMaxEn: string | null): void {
    bd.sesion = { ...bd.sesion, expiraEn, expiraMaxEn }
    guardarCookieSimulada()
}

/**
 * Clave de `localStorage` para Playwright: si existe, la siguiente petición con la cookie vence la
 * sesión (401 `sesion_expirada`) y la clave se borra. Así se prueba sin recargar la página. Con un
 * método como valor (`POST`), solo la vence la siguiente petición de ese método (las lecturas de
 * fondo, como el contador de comprobantes, no la consumen).
 */
export const CLAVE_VENCER_SESION = 'argos_fixtures_vencer_sesion'

function vencimientoPedido(metodo: string): boolean {
    try {
        const almacen = globalThis.localStorage
        const valor = almacen?.getItem(CLAVE_VENCER_SESION) ?? null
        if (!almacen || valor === null || (valor !== '1' && valor.toUpperCase() !== metodo)) {
            return false
        }
        almacen.removeItem(CLAVE_VENCER_SESION)
        return true
    }
    catch {
        return false
    }
}

const PROBLEMA_SESION_EXPIRADA: Problem = {
    type: 'urn:argosisp:problema:sesion_expirada',
    title: 'Sesión expirada',
    status: 401,
    detail: 'La sesión del panel venció. Vuelve a iniciar sesión.',
}

/**
 * Como el guard `panel` de A1 (`contratos/sesion-panel.md` §4): con la cookie vencida responde 401
 * `sesion_expirada` y la borra; si sigue vigente, la renueva hasta `min(ahora + 12 h, tope)`.
 */
function revisarVencimiento(solicitud: SolicitudFixture): RespuestaFixture | null {
    if (!solicitud.porCookie) {
        return null
    }
    // Una petición que salió con la cookie antes de que otra la venciera trae el token vencido.
    if (solicitud.token && bd.sesionesVencidas.includes(solicitud.token) && solicitud.token !== bd.sesion.token) {
        return { status: 401, cuerpo: PROBLEMA_SESION_EXPIRADA }
    }
    if (bd.sesion.expiraEn === null) {
        return null
    }
    if (vencimientoPedido(solicitud.metodo)) {
        bd.sesion.expiraEn = new Date(0).toISOString()
    }
    const ahora = Date.now()
    const tope = bd.sesion.expiraMaxEn ? new Date(bd.sesion.expiraMaxEn).getTime() : Number.POSITIVE_INFINITY
    if (Math.min(new Date(bd.sesion.expiraEn).getTime(), tope) <= ahora) {
        if (bd.sesion.token) {
            bd.sesionesVencidas.push(bd.sesion.token)
        }
        bd.sesion = { token: null, csrf: null, expiraEn: null, expiraMaxEn: null }
        guardarCookieSimulada()
        return { status: 401, cuerpo: PROBLEMA_SESION_EXPIRADA }
    }
    bd.sesion.expiraEn = new Date(Math.min(ahora + SESION_INACTIVIDAD_MS, tope)).toISOString()
    guardarCookieSimulada()
    return null
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
            const vencida = clave === 'POST /api/v1/auth/sesion' ? null : revisarVencimiento(solicitud)
            if (vencida) {
                return vencida
            }
            if (csrfInvalido(solicitud, clave)) {
                return { status: 403, cuerpo: PROBLEMA_CSRF }
            }
            return empresaNoPermitida(solicitud) ?? manejador(solicitud)
        },
    ]))
}

export const rutasFixture: RutasFixture = conFallasSimuladas({
    'POST /api/v1/auth/login': ({ cuerpo }) => {
        const revision = revisarCredenciales(cuerpo)
        return revision.ok ? { status: 200, cuerpo: revision.respuesta } : revision.falla
    },

    /**
     * Como `POST /auth/sesion` (A1, `contratos/sesion-panel.md`): mismas credenciales que el login,
     * pero el token va a la cookie `argos_sesion` (aquí, `bd.sesion`) y el cuerpo trae el `csrf`.
     */
    'POST /api/v1/auth/sesion': ({ cuerpo }) => {
        const revision = revisarCredenciales(cuerpo)
        if (!revision.ok) {
            return revision.falla
        }
        const respuesta = revision.respuesta
        const csrf = `csrf-${respuesta.token}-${Date.now().toString(36)}`
        const ahora = Date.now()
        const expiraEn = new Date(ahora + SESION_INACTIVIDAD_MS).toISOString()
        const expiraMaxEn = new Date(ahora + SESION_MAXIMA_MS).toISOString()
        bd.sesion = { token: respuesta.token, csrf, expiraEn, expiraMaxEn }
        guardarCookieSimulada()
        const sesion: Schema<'SesionPanel'> = {
            usuario: { ...respuesta.usuario, csrf },
            csrf,
            expira_en: expiraEn,
            expira_max_en: expiraMaxEn,
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
            bd.sesion = { token: null, csrf: null, expiraEn: null, expiraMaxEn: null }
            guardarCookieSimulada()
        }
        return { status: 204, cuerpo: undefined }
    },

    /** Con la cookie, `Me` trae el `csrf` (así el panel lo recupera tras recargar). */
    'GET /api/v1/me': (solicitud) => {
        const { token, porCookie } = solicitud
        const usuario = token ? usuariosPorToken[token] : undefined
        if (!usuario) {
            return sinSesion()
        }
        // Multiempresa: la empresa activa de esta petición (`X-Empresa-Id` o la única del usuario).
        const empresaActiva = { empresa_activa_id: empresaActivaDe(solicitud) }
        if (!porCookie) {
            return { status: 200, cuerpo: { ...usuario, ...empresaActiva } }
        }
        // Con la cookie: `csrf` y los vencimientos (ya renovados por esta misma petición).
        const me: Schema<'Me'> = {
            ...usuario,
            ...empresaActiva,
            expira_en: bd.sesion.expiraEn,
            expira_max_en: bd.sesion.expiraMaxEn,
        }
        if (bd.sesion.csrf) {
            me.csrf = bd.sesion.csrf
        }
        return { status: 200, cuerpo: me }
    },

    ...rutasEmpresas,
    ...rutasNotificaciones,
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
    ...rutasEstadosFinancieros,
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
