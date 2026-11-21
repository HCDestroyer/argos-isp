import { createHmac } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { descifrar } from '#shared/cifrado'
import { Problema, type ErrorCampo, type ProblemaJson } from '#shared/errores'
import { configIris, contratoAdmite, leerFilaIris } from '#integraciones/iris/configuracion'

/**
 * Cliente de las rutas del portal del cliente de Iris (contrato Iris 0.9.0 §11, pedidos A30 y A31).
 *
 * Argos llama a Iris **servidor a servidor**, en nombre de un cliente que el portal ya identificó:
 *
 * - `Authorization: Bearer <token_portal>` (§1.2): el token aparte, recortado a `portal_argos.*`.
 *   Nunca sale de este proceso (ni al navegador, ni al log, ni a la auditoría).
 * - `X-Iris-Empresa`: la empresa del servicio, resuelta aquí con la sesión (nunca la que dice el
 *   navegador sin validarla: `soporte/sesion.ts`).
 * - `X-Argos-Portal-Sesion: <documento|ip>:<id>`: `id` es un HMAC del id de la sesión del portal
 *   (`idSesionIris`), estable y opaco; nunca el documento, la IP ni la cookie.
 * - `Idempotency-Key: argos:portal:<operacion>:<id>` en todo `POST` (§11.2).
 *
 * Disponibilidad (`disponibilidadSoporte`): conector Iris activo con URL, contrato ≥ 0.9.0
 * (`conectorAdmite`), `token_portal` guardado y `capacidades.portal_argos` en
 * `GET <iris>/api/v1/integraciones/argosisp/estado` (§4.3; se lee con el token del panel, el de
 * §1.2, en cada consulta: sin caché, regla 5). Sin conector configurado (`sin_iris`) el portal no
 * muestra la sección; en los demás casos la muestra con el error y «Reintentar».
 *
 * Errores: los de Iris se traducen a problemas de Argos con el mismo código (`urn:argosisp:problema:<codigo>`)
 * y un texto para el cliente (`traducirProblemaIris`). Lo que es de configuración (token, empresa,
 * conector apagado, Iris anterior a 0.9.0, red, 5xx) sale como `503 soporte_no_disponible`, sin
 * detalles internos.
 */

/** Contrato mínimo del conector para las rutas de §11. */
export const CONTRATO_PORTAL_IRIS = '0.9.0'
/** Contrato mínimo para las sesiones de un contacto a cargo (§11.10, `X-Iris-Contacto`). */
export const CONTRATO_CONTACTOS_IRIS = '0.12.1'

const RUTA_BASE = '/api/v1/integraciones/argosisp/portal/clientes'
const RUTA_ESTADO = '/api/v1/integraciones/argosisp/estado'
const TIMEOUT_MS = 10_000

export interface CapacidadesIris {
    portal_argos: boolean
    solicitudes_servicio: boolean
    adjuntos_ticket: boolean
}

export type EstadoSoporte =
    | 'disponible'
    /** no hay conector Iris en esta instalación: el portal no muestra la sección */
    | 'sin_iris'
    /** el conector está apagado */
    | 'apagado'
    /** el Iris conectado habla un contrato < 0.9.0 o no informa `capacidades.portal_argos` */
    | 'version'
    /** falta el `token_portal` (Iris no lo entregó o Argos aún no lo guarda) */
    | 'sin_token'
    /** Iris no respondió al leer su estado */
    | 'sin_respuesta'

export interface DisponibilidadSoporte {
    estado: EstadoSoporte
    capacidades: CapacidadesIris | null
    /** el Iris conectado admite tickets pedidos por un contacto a cargo (contrato ≥ 0.12.1, §11.10) */
    contactos: boolean
}

/** Lo que el portal necesita del conector (secretos en claro: nunca salen del proceso). */
export interface ConectorPortalIris {
    activo: boolean
    urlBase: string | null
    /** token del panel (§1.2), para leer el estado y las capacidades */
    tokenPanel: string | null
    /** `token_portal` (§1.2, 0.9.0) */
    tokenPortal: string | null
    contrato: string | null
}

/**
 * De dónde sale el `token_portal`. El conector (A1, `integraciones.iris_conector`) aún no lo guarda
 * (pedido en `.claude/integration/a5.md`): se lee de la columna `token_portal_cifrado` en cuanto
 * exista y, mientras tanto, de `IRIS_TOKEN_PORTAL` (solo laboratorio).
 */
async function conectorPorDefecto(): Promise<ConectorPortalIris> {
    const [fila, config] = await Promise.all([leerFilaIris(), configIris()])
    const cifrado = (fila as unknown as { token_portal_cifrado?: string | null } | null)?.token_portal_cifrado
    let tokenPortal: string | null = null
    if (cifrado) {
        try {
            tokenPortal = descifrar(cifrado)
        } catch {
            logger.error('portal: no se pudo descifrar el token_portal de Iris')
        }
    }
    tokenPortal ??= process.env.IRIS_TOKEN_PORTAL?.trim() || null
    return {
        activo: config.activo,
        urlBase: config.urlBase,
        tokenPanel: config.token,
        tokenPortal,
        contrato: fila?.contrato ?? null,
    }
}

let fuenteConector: () => Promise<ConectorPortalIris> = conectorPorDefecto
let fetchIris: typeof fetch = (...args) => fetch(...args)

/** Las pruebas reemplazan el conector (sin el argumento, vuelve al de la base). */
export function fijarConectorPortalIris(fn?: () => Promise<ConectorPortalIris>): void {
    fuenteConector = fn ?? conectorPorDefecto
}

/** Las pruebas reemplazan `fetch` (Iris falso). */
export function fijarFetchPortalIris(fn?: typeof fetch): void {
    fetchIris = fn ?? ((...args) => fetch(...args))
}

function capacidadesDe(valor: unknown): CapacidadesIris | null {
    if (typeof valor !== 'object' || valor === null) return null
    const c = valor as Record<string, unknown>
    if (typeof c.portal_argos !== 'boolean') return null
    return {
        portal_argos: c.portal_argos,
        solicitudes_servicio: c.solicitudes_servicio === true,
        adjuntos_ticket: c.adjuntos_ticket === true,
    }
}

/** ¿Se pueden usar las rutas de §11 ahora? Lee el conector y las capacidades de Iris (sin caché). */
export async function disponibilidadSoporte(): Promise<DisponibilidadSoporte> {
    const conector = await fuenteConector()
    if (!conector.urlBase) return { estado: 'sin_iris', capacidades: null, contactos: false }
    if (!conector.activo) return { estado: 'apagado', capacidades: null, contactos: false }
    if (!contratoAdmite(conector.contrato, CONTRATO_PORTAL_IRIS)) {
        return { estado: 'version', capacidades: null, contactos: false }
    }
    if (!conector.tokenPortal) return { estado: 'sin_token', capacidades: null, contactos: false }
    let capacidades: CapacidadesIris | null = null
    try {
        const respuesta = await fetchIris(`${conector.urlBase}${RUTA_ESTADO}`, {
            headers: {
                Accept: 'application/json',
                ...(conector.tokenPanel ? { Authorization: `Bearer ${conector.tokenPanel}` } : {}),
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!respuesta.ok) return { estado: 'sin_respuesta', capacidades: null, contactos: false }
        const cuerpo = (await respuesta.json()) as { capacidades?: unknown }
        capacidades = capacidadesDe(cuerpo.capacidades)
    } catch (error) {
        logger.warn({ err: error }, 'portal: Iris no respondió al leer su estado')
        return { estado: 'sin_respuesta', capacidades: null, contactos: false }
    }
    if (!capacidades?.portal_argos) return { estado: 'version', capacidades, contactos: false }
    return {
        estado: 'disponible',
        capacidades,
        contactos: contratoAdmite(conector.contrato, CONTRATO_CONTACTOS_IRIS),
    }
}

const MENSAJES_NO_DISPONIBLE: Record<Exclude<EstadoSoporte, 'disponible'>, string> = {
    sin_iris: 'Esta empresa no atiende tickets desde el portal. Escríbenos por los medios de contacto.',
    apagado: 'El soporte en línea no está disponible ahora. Intenta de nuevo más tarde.',
    version: 'El soporte en línea no está disponible por ahora. Intenta de nuevo más tarde.',
    sin_token: 'El soporte en línea no está disponible por ahora. Intenta de nuevo más tarde.',
    sin_respuesta: 'No pudimos contactar al equipo de soporte. Intenta de nuevo en unos minutos.',
}

/** 503 `soporte_no_disponible`: Iris apagado, anterior a 0.9.0, sin token o sin respuesta. */
export class SoporteNoDisponible extends Problema {
    readonly estadoSoporte: EstadoSoporte

    constructor(estado: Exclude<EstadoSoporte, 'disponible'> = 'sin_respuesta', detalle?: string) {
        super(
            503,
            'soporte_no_disponible',
            'Soporte no disponible',
            detalle ?? MENSAJES_NO_DISPONIBLE[estado],
        )
        this.estadoSoporte = estado
    }
}

/** 409 `solicitud_abierta` con el id de la solicitud que ya está abierta (`solicitud_id`, §11.7). */
export class SolicitudAbierta extends Problema {
    constructor(readonly solicitudId: number | null) {
        super(
            409,
            'solicitud_abierta',
            'Ya tienes una solicitud abierta',
            'Ya tienes una solicitud de ese tipo en curso. Te avisaremos cuando avance.',
        )
    }

    toJSON(): ProblemaJson & { solicitud_id: number | null } {
        return { ...super.toJSON(), solicitud_id: this.solicitudId }
    }
}

/** 429 de Iris con su `Retry-After` (el handler de excepciones lo pone en la respuesta). */
export class TopeIris extends Problema {
    constructor(
        codigo: string,
        detalle: string,
        readonly reintentarEnS: number,
    ) {
        super(429, codigo, 'Demasiadas solicitudes', detalle)
    }
}

/** Texto para el cliente de cada código de Iris que puede ver (§4.3, errores de §11). */
const TEXTOS_CLIENTE: Record<string, { status: number; titulo: string; detalle: string }> = {
    no_encontrado: {
        status: 404,
        titulo: 'No encontrado',
        detalle: 'No encontramos ese ticket o esa solicitud en tu cuenta.',
    },
    sesion_insuficiente: {
        status: 403,
        titulo: 'Entra a tu cuenta',
        detalle: 'Para ver el detalle o responder, entra con tu código o tu contraseña.',
    },
    transicion_invalida: {
        status: 422,
        titulo: 'No se puede hacer ahora',
        detalle: 'El ticket cambió de estado. Actualiza la página para ver cómo va.',
    },
    conflicto_version: {
        status: 409,
        titulo: 'El ticket cambió',
        detalle: 'Soporte actualizó el ticket mientras escribías. Actualiza y vuelve a intentar.',
    },
    adjuntos_no_permitidos: {
        status: 422,
        titulo: 'Sin adjuntos',
        detalle: 'Para adjuntar fotos o PDF entra con tu código o tu contraseña.',
    },
    tamano_excedido: {
        status: 413,
        titulo: 'Archivo muy grande',
        detalle: 'Cada archivo puede pesar hasta 10 MB.',
    },
    mime_no_permitido: {
        status: 422,
        titulo: 'Tipo de archivo no permitido',
        detalle: 'Solo fotos (JPG, PNG, WebP o HEIC) y PDF.',
    },
    demasiados_adjuntos: {
        status: 422,
        titulo: 'Demasiados archivos',
        detalle: 'Puedes adjuntar hasta 3 archivos.',
    },
    servicio_requerido: {
        status: 422,
        titulo: 'Elige el servicio',
        detalle: 'Indica a qué servicio se refiere la solicitud.',
    },
    empresa_no_coincide: {
        status: 422,
        titulo: 'Cuenta no encontrada en soporte',
        detalle: 'Soporte no encontró tu cuenta en esta empresa. Comunícate por los medios de contacto.',
    },
    cliente_no_existe: {
        status: 422,
        titulo: 'Cuenta no encontrada en soporte',
        detalle: 'Soporte no encontró tu cuenta. Comunícate por los medios de contacto.',
    },
    argos_no_disponible: {
        status: 503,
        titulo: 'Soporte no disponible',
        detalle: 'Soporte no pudo confirmar tu cuenta ahora. Intenta de nuevo en unos minutos.',
    },
    idempotencia_reutilizada: {
        status: 422,
        titulo: 'Envío repetido',
        detalle: 'Ese envío ya se usó con otros datos. Vuelve a abrir el formulario.',
    },
    servicio_fuera_del_contacto: {
        status: 403,
        titulo: 'Servicio fuera de tu cargo',
        detalle:
            'Ese servicio ya no está a tu cargo. Actualiza la página o pídele al titular que te agregue.',
    },
    permiso_de_contacto: {
        status: 403,
        titulo: 'Sin permiso del titular',
        detalle: 'El titular de este servicio no te dio permiso para esto.',
    },
    solo_titular: {
        status: 403,
        titulo: 'Solo el titular',
        detalle: 'Esto solo lo puede pedir el titular del servicio.',
    },
    idempotencia_en_proceso: {
        status: 409,
        titulo: 'Seguimos enviando',
        detalle: 'Tu envío anterior todavía se está procesando. Intenta de nuevo en unos segundos.',
    },
}

const TOPES: Record<string, string> = {
    demasiados_tickets: 'Ya abriste muchos tickets. Espera un poco o sigue los que tienes abiertos.',
    demasiados_mensajes: 'Enviaste muchos mensajes seguidos. Espera un minuto e intenta de nuevo.',
    demasiadas_solicitudes: 'Ya enviaste varias solicitudes hoy. Intenta de nuevo mañana.',
    demasiadas_peticiones: 'Soporte está recibiendo muchas consultas. Intenta de nuevo en un momento.',
}

/** Códigos de configuración o de credencial: al cliente solo «soporte no disponible». */
const DE_CONFIGURACION = new Set([
    'solo_integracion_argos',
    'empresa_no_permitida',
    'cabecera_requerida',
    'cabecera_iris_requerida',
    'argos_apagado',
    'idempotency_key_requerida',
])

function codigoIris(tipo: unknown): string | null {
    if (typeof tipo !== 'string') return null
    const m = /^urn:(?:iris|argosisp):problema:([a-z0-9_]+)$/.exec(tipo)
    return m ? m[1]! : null
}

/** Mensajes de validación de Iris por campo (sin repetir lo que escribió el cliente). */
const TEXTO_REGLA: Record<string, string> = {
    categoria: 'Elige una categoría de la lista',
    servicio: 'Ese servicio no es de tu cuenta',
    plan: 'Elige un plan de la lista',
}

/** Problema de Iris → problema de Argos para el cliente (§4.3). */
export function traducirProblemaIris(status: number, cuerpo: unknown, retryAfter: string | null): Problema {
    const json = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>
    const codigo = codigoIris(json.type)
    if (status === 429) {
        const segundos = Math.max(1, Number.parseInt(retryAfter ?? '', 10) || 60)
        const clave = codigo && codigo in TOPES ? codigo : 'demasiadas_peticiones'
        return new TopeIris(clave, TOPES[clave]!, segundos)
    }
    if (codigo === 'solicitud_abierta') {
        const ext = (json.extensions ?? json) as Record<string, unknown>
        const id = Number(ext.solicitud_id)
        return new SolicitudAbierta(Number.isSafeInteger(id) && id > 0 ? id : null)
    }
    if (codigo === 'validacion') {
        const errores: ErrorCampo[] = Array.isArray(json.errors)
            ? (json.errors as Array<Record<string, unknown>>).map((e) => {
                  const regla = typeof e.rule === 'string' ? e.rule : undefined
                  return {
                      field: typeof e.field === 'string' ? e.field : 'datos',
                      message: (regla && TEXTO_REGLA[regla]) || 'Revisa este dato',
                      ...(regla ? { rule: regla } : {}),
                  }
              })
            : []
        return new Problema(422, 'validacion', 'Datos inválidos', 'Revisa los datos marcados', errores)
    }
    if (codigo && codigo in TEXTOS_CLIENTE) {
        const t = TEXTOS_CLIENTE[codigo]!
        return new Problema(t.status, codigo, t.titulo, t.detalle)
    }
    if (codigo && DE_CONFIGURACION.has(codigo)) {
        logger.warn({ codigo, status }, 'portal: Iris rechazó la credencial o la configuración del portal')
        return new SoporteNoDisponible(codigo === 'argos_apagado' ? 'apagado' : 'sin_respuesta')
    }
    // 404 sin problem+json (un Iris sin las rutas de §11), 401, 5xx u otro: no disponible.
    logger.warn({ codigo, status }, 'portal: respuesta inesperada de Iris')
    return new SoporteNoDisponible('sin_respuesta')
}

// ── Llamadas ─────────────────────────────────────────────────────────────────────────────────

/** Cómo identificó Argos al cliente (§11.2): `documento` (código o contraseña) o `ip` (página de corte). */
export type MetodoSesionIris = 'documento' | 'ip'

export interface SesionIris {
    metodo: MetodoSesionIris
    /** id de `core.portal_sesiones` (se manda solo su HMAC) */
    sesionId: number
}

/** `id` opaco y estable de la sesión para `X-Argos-Portal-Sesion`: 32 caracteres base64url. */
export function idSesionIris(sesionId: number): string {
    return createHmac('sha256', env.get('APP_KEY'))
        .update(`argos:portal:sesion:${sesionId}`)
        .digest('base64url')
        .slice(0, 32)
}

export function cabeceraSesionIris(sesion: SesionIris): string {
    return `${sesion.metodo}:${idSesionIris(sesion.sesionId)}`
}

export interface ArchivoIris {
    nombre: string
    mime: string
    contenido: Uint8Array
}

export interface PeticionIris {
    metodo: 'GET' | 'POST'
    /** id del cliente en Argos (el de la ruta de §11) */
    clienteId: number
    empresaId: number
    sesion: SesionIris
    /** ruta debajo de `…/clientes/{cliente_id}`, con su consulta (`/tickets?limit=20`) */
    ruta: string
    cuerpo?: Record<string, unknown>
    archivos?: ArchivoIris[]
    /** `argos:portal:<operacion>:<id>` (obligatoria en `POST`) */
    idempotencia?: string
    /**
     * Quién pide (contrato 0.12.1 §11.10): `titular`, o el contacto a cargo (A46) con su `version` de
     * `core.contactos_cliente`, ya validado en Argos (`servicioACargo` / `contactoACargo`).
     */
    contacto: ContactoIris
}

export type ContactoIris = 'titular' | { id: number; version: number }

/** `X-Iris-Contacto` y, con un contacto, `X-Iris-Contacto-Version` (§11.10). */
export function cabecerasContactoIris(contacto: ContactoIris): Record<string, string> {
    if (contacto === 'titular') return { 'X-Iris-Contacto': 'titular' }
    return { 'X-Iris-Contacto': String(contacto.id), 'X-Iris-Contacto-Version': String(contacto.version) }
}

/** Conector listo para llamar o `503 soporte_no_disponible`. */
async function conectorListo(contacto: ContactoIris): Promise<{ urlBase: string; token: string }> {
    const conector = await fuenteConector()
    if (!conector.urlBase) throw new SoporteNoDisponible('sin_iris')
    if (!conector.activo) throw new SoporteNoDisponible('apagado')
    if (!contratoAdmite(conector.contrato, CONTRATO_PORTAL_IRIS)) throw new SoporteNoDisponible('version')
    // §4 (0.12.1): con un Iris anterior, Argos nunca manda al portal sesiones de contactos
    if (contacto !== 'titular' && !contratoAdmite(conector.contrato, CONTRATO_CONTACTOS_IRIS)) {
        throw new SoporteNoDisponible('version')
    }
    if (!conector.tokenPortal) throw new SoporteNoDisponible('sin_token')
    return { urlBase: conector.urlBase, token: conector.tokenPortal }
}

function cuerpoDeLaPeticion(peticion: PeticionIris): { body?: string | FormData; tipo?: string } {
    if (peticion.metodo === 'GET') return {}
    const datos = JSON.stringify(peticion.cuerpo ?? {})
    if (!peticion.archivos || peticion.archivos.length === 0) return { body: datos, tipo: 'application/json' }
    // §11.4: la parte `datos` con el mismo JSON y hasta 3 partes `archivos`
    const formulario = new FormData()
    formulario.append('datos', new Blob([datos], { type: 'application/json' }))
    for (const archivo of peticion.archivos) {
        formulario.append(
            'archivos',
            new Blob([Buffer.from(archivo.contenido)], { type: archivo.mime }),
            archivo.nombre,
        )
    }
    return { body: formulario }
}

/** Respuesta cruda de Iris (2xx) o el problema ya traducido. */
export async function llamarIris(peticion: PeticionIris): Promise<Response> {
    const { urlBase, token } = await conectorListo(peticion.contacto)
    const { body, tipo } = cuerpoDeLaPeticion(peticion)
    const cabeceras: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Iris-Empresa': String(peticion.empresaId),
        'X-Argos-Portal-Sesion': cabeceraSesionIris(peticion.sesion),
        ...cabecerasContactoIris(peticion.contacto),
    }
    if (tipo) cabeceras['Content-Type'] = tipo
    if (peticion.idempotencia) cabeceras['Idempotency-Key'] = peticion.idempotencia
    let respuesta: Response
    try {
        respuesta = await fetchIris(`${urlBase}${RUTA_BASE}/${peticion.clienteId}${peticion.ruta}`, {
            method: peticion.metodo,
            headers: cabeceras,
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
    } catch (error) {
        logger.warn({ err: error, ruta: peticion.ruta }, 'portal: Iris no respondió')
        throw new SoporteNoDisponible('sin_respuesta')
    }
    if (respuesta.ok) return respuesta
    let cuerpo: unknown = null
    try {
        cuerpo = await respuesta.json()
    } catch {
        cuerpo = null
    }
    throw traducirProblemaIris(respuesta.status, cuerpo, respuesta.headers.get('retry-after'))
}

/** `llamarIris` y el cuerpo JSON. */
export async function llamarIrisJson<T>(peticion: PeticionIris): Promise<T> {
    const respuesta = await llamarIris(peticion)
    try {
        return (await respuesta.json()) as T
    } catch {
        throw new SoporteNoDisponible('sin_respuesta')
    }
}
