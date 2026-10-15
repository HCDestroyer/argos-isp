/**
 * Piezas comunes de los fixtures: sesión y permisos, paginación por cursor y errores RFC 9457.
 * Se comportan como la API real lo suficiente para probar pantallas sin backend.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import type { ManejadorFixture, RespuestaFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import loginAdmin from './auth/login.admin.json'
import loginCajero from './auth/login.cajero.json'
import meAdmin from './auth/me.admin.json'
import meCajero from './auth/me.cajero.json'

export const usuariosPorToken: Record<string, Schema<'Me'>> = {
    [loginAdmin.token]: meAdmin,
    [loginCajero.token]: meCajero,
}

export function problema(status: number, title: string, detail?: string, errors?: Problem['errors']): RespuestaFixture {
    const cuerpo: Problem = { type: 'about:blank', title, status }
    if (detail) {
        cuerpo.detail = detail
    }
    if (errors) {
        cuerpo.errors = errors
    }
    return { status, cuerpo }
}

export const sinSesion = (): RespuestaFixture => problema(401, 'Sin sesión', 'El token no es válido o expiró.')

/** Exige sesión y el permiso de la acción, como el middleware de ACL de la API. */
export function conPermiso(permiso: string, manejador: ManejadorFixture): ManejadorFixture {
    return (solicitud) => {
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (!usuario) {
            return sinSesion()
        }
        if (!usuario.permisos.includes(permiso)) {
            return problema(403, 'Sin permiso', `Falta el permiso ${permiso}.`)
        }
        return manejador(solicitud)
    }
}

export const noEncontrado = (recurso: string): RespuestaFixture => problema(404, 'No encontrado', `No existe ${recurso}.`)

/** Id numérico de la ruta (`:id`), o `null` si no es válido. */
export function idDe(solicitud: SolicitudFixture, nombre = 'id'): number | null {
    const id = Number(solicitud.params[nombre])
    return Number.isInteger(id) && id > 0 ? id : null
}

/** Número de un query param, o `undefined`. */
export function numeroQuery(solicitud: SolicitudFixture, nombre: string): number | undefined {
    const valor = solicitud.query.get(nombre)
    if (valor === null || valor === '') {
        return undefined
    }
    const numero = Number(valor)
    return Number.isFinite(numero) ? numero : undefined
}

/** Objeto del cuerpo JSON, o `{}`. */
export function cuerpoObjeto(solicitud: SolicitudFixture): Record<string, unknown> {
    const { cuerpo } = solicitud
    return typeof cuerpo === 'object' && cuerpo !== null && !Array.isArray(cuerpo) ? { ...cuerpo } : {}
}

/** Texto sin acentos y en minúsculas, para búsquedas. */
export function normalizar(texto: string | null | undefined): string {
    return (texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
}

/**
 * Paginación por cursor sobre un arreglo ya filtrado y ordenado. El cursor es opaco
 * (aquí el desplazamiento en base64), igual que en la API.
 */
export function paginar<T>(filas: T[], solicitud: SolicitudFixture, limitePorDefecto = 50): { data: T[], nextCursor: string | null } {
    const limite = Math.min(Math.max(numeroQuery(solicitud, 'limit') ?? limitePorDefecto, 1), 200)
    const cursor = solicitud.query.get('cursor')
    const desde = cursor ? Number(atob(cursor)) || 0 : 0
    const data = filas.slice(desde, desde + limite)
    const siguiente = desde + limite
    return { data, nextCursor: siguiente < filas.length ? btoa(String(siguiente)) : null }
}

export function ahora(): string {
    return new Date().toISOString()
}
