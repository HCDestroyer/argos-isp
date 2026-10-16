/**
 * Rutas del modo fixtures del panel. Cada respuesta se tipa contra `@argosisp/contracts`
 * para que un cambio de contrato rompa el typecheck aquí y no en pantalla.
 *
 * Usuarios: `admin@argos.test` y `cajero@argos.test`, cualquier contraseña.
 * Para agregar un recurso: crea `fixtures/<recurso>/datos.ts` (tipado con `Schema<'X'>`),
 * sus rutas en `fixtures/<recurso>/rutas.ts` y regístralas abajo. Los datos mutables viven
 * en `bd.ts` (`reiniciarFixtures()` en pruebas).
 */
import type { Problem, paths } from '@argosisp/contracts'
import type { ManejadorFixture, RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd } from './bd'
import loginAdmin from './auth/login.admin.json'
import loginCajero from './auth/login.cajero.json'
import login401 from './auth/login.401.json'
import { rutasBitacora } from './bitacora/rutas'
import { rutasCajas } from './cajas/rutas'
import { rutasClientes } from './clientes/rutas'
import { rutasFacturacion } from './facturacion/rutas'
import { rutasLibro } from './libro/rutas'
import { sinSesion, usuariosPorToken } from './comun'
import { rutasPlanes } from './planes/rutas'
import { rutasPlantillas } from './plantillas/rutas'
import { rutasPromesas } from './promesas/rutas'
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
            return status ? respuestaFalla(clave, status) : manejador(solicitud)
        },
    ]))
}

export const rutasFixture: RutasFixture = conFallasSimuladas({
    'POST /api/v1/auth/login': ({ cuerpo }) => {
        const respuesta = logins[emailDe(cuerpo)]
        return respuesta ? { status: 200, cuerpo: respuesta } : { status: 401, cuerpo: credencialesInvalidas }
    },

    'GET /api/v1/me': ({ token }) => {
        const usuario = token ? usuariosPorToken[token] : undefined
        return usuario ? { status: 200, cuerpo: usuario } : sinSesion()
    },

    ...rutasZonas,
    ...rutasClientes,
    ...rutasServicios,
    ...rutasAsignaciones,
    ...rutasRouters,
    ...rutasPlanes,
    ...rutasPlantillas,
    ...rutasBitacora,
    ...rutasSesiones,
    ...rutasFacturacion,
    ...rutasLibro,
    ...rutasCajas,
    ...rutasPromesas,
    ...rutasUsuarios,
})
