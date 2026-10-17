/**
 * Piezas comunes de los fixtures: sesión y permisos, paginación por cursor y errores RFC 9457.
 * Se comportan como la API real lo suficiente para probar pantallas sin backend.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import type { ManejadorFixture, RespuestaFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from './bd'
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

/** Problem con `type` propio, como `tipoProblema(codigo)` de la API (`urn:argosisp:problema:<codigo>`). */
export function problemaTipado(status: number, codigo: string, title: string, detail?: string, errors?: Problem['errors']): RespuestaFixture {
    const respuesta = problema(status, title, detail, errors)
    return { ...respuesta, cuerpo: { ...(respuesta.cuerpo as Problem), type: `urn:argosisp:problema:${codigo}` } }
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

/**
 * Repite la respuesta guardada si el `Idempotency-Key` ya se usó, como `core.idempotency_keys`.
 * Solo se guardan respuestas exitosas.
 */
export function conIdempotencia(manejador: ManejadorFixture): ManejadorFixture {
    return async (solicitud) => {
        const clave = solicitud.headers.get('Idempotency-Key')
        const guardada = clave ? bd.idempotencia[clave] : undefined
        if (guardada) {
            return guardada
        }
        const respuesta = await manejador(solicitud)
        if (clave && respuesta.status < 300) {
            bd.idempotencia[clave] = respuesta
        }
        return respuesta
    }
}

/** Escribe en la bitácora de fixtures lo que haría `DomainAction`. */
export function registrarAccion(solicitud: SolicitudFixture, accion: string, entidad: { tipo: string, id: number }, entrada: unknown): void {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const id = siguienteId(bd.acciones)
    bd.acciones.push({
        id,
        actor_tipo: 'usuario',
        actor_id: usuario?.id ?? null,
        actor_nombre: usuario?.nombre ?? null,
        // Como `request_id_middleware` de la API: el canal sale del header `X-Canal` (por defecto `api`).
        canal: solicitud.headers.get('X-Canal') ?? 'api',
        accion,
        entidad_tipo: entidad.tipo,
        entidad_id: entidad.id,
        entrada,
        resultado: 'ok',
        error: null,
        request_id: `req-fixture-${id}`,
        created_at: ahora(),
    })
}

export const versionCambiada = (): RespuestaFixture => problema(409, 'Conflicto de versión', 'Otra persona modificó este registro. Vuelve a cargarlo.')

export function datosInvalidos(errors: NonNullable<Problem['errors']>): RespuestaFixture {
    return problema(422, 'Datos inválidos', 'Revisa los campos marcados.', errors)
}

/**
 * Empresa activa de la petición, como el middleware `empresa` de A1: `X-Empresa-Id` o, sin
 * cabecera, la única empresa del usuario (con varias, ninguna).
 */
export function empresaActivaDe(solicitud: SolicitudFixture): number | null {
    const cabecera = Number(solicitud.headers.get('X-Empresa-Id'))
    if (Number.isInteger(cabecera) && cabecera > 0) {
        return cabecera
    }
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const suyas = usuario?.empresas ?? []
    return !usuario?.alcance_global && suyas.length === 1 ? suyas[0]?.id ?? null : null
}

/** 403 `empresa_no_permitida` si la cabecera pide una empresa fuera del alcance del usuario. */
export function empresaNoPermitida(solicitud: SolicitudFixture): RespuestaFixture | null {
    const pedida = Number(solicitud.headers.get('X-Empresa-Id'))
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    if (!usuario || !Number.isInteger(pedida) || pedida <= 0) {
        return null
    }
    const existe = bd.empresas.some(e => e.id === pedida && e.activa)
    const permitida = existe && (usuario.alcance_global || (usuario.empresas ?? []).some(e => e.id === pedida))
    return permitida ? null : problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${pedida}`)
}

/**
 * Empresas por las que filtra una lista (`empresasDeLaLista` de A1): la activa; sin activa, las del
 * alcance del usuario (`null` = todas con alcance global); `?empresas=todas` → `null` (consolidado).
 */
export function empresasDeLista(solicitud: SolicitudFixture): number[] | null {
    if (solicitud.query.get('empresas') === 'todas') {
        return null
    }
    const activa = empresaActivaDe(solicitud)
    if (activa) {
        return [activa]
    }
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    return !usuario || usuario.alcance_global ? null : (usuario.empresas ?? []).map(e => e.id)
}
