import type { HttpContext } from '@adonisjs/core/http'
import type { VineValidator } from '@vinejs/vine'
import type { Infer, SchemaTypes } from '@vinejs/vine/types'
import type { EsquemaJson } from '#shared/openapi/esquemas'
import { NoImplementado } from '#shared/errores'
import type { Permiso } from '#core/permisos'

/**
 * Registro de rutas de la API. Cada ruta se declara una sola vez con su validador VineJS, su
 * permiso y su schema de respuesta; de aquí salen tanto el router de AdonisJS
 * (`start/routes.ts`) como el OpenAPI (`node ace openapi:generate`).
 *
 * Si una ruta no tiene `handler`, responde 501 Problem (después de autenticar, autorizar y validar).
 */

export const PREFIJO_API = '/api/v1'

export type MetodoHttp = 'get' | 'post' | 'put' | 'delete'

/**
 * - `sesion`: Bearer de login, token de API o cookie `HttpOnly` del panel (con CSRF) + permiso del ACL.
 * - `interno`: Bearer con `INTERNAL_TOKEN` (servicios aaa y coa).
 * - `portal`: cookie de sesión del portal del cliente (`argos_portal`). El router no monta
 *   middleware: el handler la exige con `exigirSesionPortal` (A5); el OpenAPI declara el esquema
 *   `portal` y su 401.
 * - `publico`: sin autenticación (login, portal por IP).
 */
export type Seguridad = 'sesion' | 'interno' | 'portal' | 'publico'

/** Nombre de la cookie de sesión del portal (esquema de seguridad `portal` del OpenAPI). */
export const COOKIE_PORTAL = 'argos_portal'

/** Cookie `HttpOnly` de la sesión del panel (esquema `panel`; `app/core/auth/sesion_panel.ts`). */
export const COOKIE_SESION_PANEL = 'argos_sesion'

type ValidadorVine = VineValidator<SchemaTypes, any>
type Salida<V> = V extends VineValidator<infer S, any> ? Infer<S> : undefined

export interface EntradaHandler<C, Q> {
    cuerpo: C
    query: Q
    params: Record<string, number | string>
}

export interface RespuestaRuta {
    /**
     * `303`: redirección (See Other). El handler devuelve `redirigir(url)`; `despachar` pone
     * `Location` y el status. Sin `esquema` ni `contenido`; el OpenAPI declara la cabecera `Location`.
     */
    status: 200 | 201 | 202 | 204 | 303
    descripcion: string
    /** schema JSON de la respuesta exitosa; omitir con 204, 303 o con `contenido` binario */
    esquema?: EsquemaJson
    /**
     * Tipo de contenido de la respuesta. Por defecto `application/json`. Un tipo binario
     * (`application/pdf`, `text/csv`, `image/png`…) se declara con `{ type: string, format: binary }`
     * y no lleva `esquema`.
     */
    contenido?: string
    /**
     * Respuesta con `ETag`: el handler puede devolver `sinCambios()` cuando `If-None-Match`
     * coincide y la ruta responde 304 sin cuerpo. El OpenAPI declara el 304.
     */
    etag?: boolean
}

/**
 * Cuerpo `multipart/form-data`: los campos de texto los valida el validador VineJS de `cuerpo`
 * (y salen en el OpenAPI); los archivos se leen en el handler con `ctx.request.file(nombre)`.
 */
export interface CuerpoMultipart {
    /** campo → descripción del archivo (se declara `format: binary`) */
    archivos: Record<string, string>
    /** archivos que pueden faltar (por defecto todos son obligatorios) */
    archivosOpcionales?: string[]
}

export interface DefinicionRuta<
    VC extends ValidadorVine | undefined = undefined,
    VQ extends ValidadorVine | undefined = undefined,
> {
    metodo: MetodoHttp
    /** relativa a `/api/v1`, con parámetros estilo AdonisJS: `/servicios/:id/suspender` */
    ruta: string
    /** operationId del OpenAPI (camelCase, único) */
    operacion: string
    resumen: string
    descripcion?: string
    /** tag del OpenAPI (agrupa en la documentación) */
    etiqueta: string
    /** por defecto `sesion` */
    seguridad?: Seguridad
    /** permiso del ACL; obligatorio con `seguridad: 'sesion'` salvo `null` explícito (p. ej. `/me`) */
    permiso: Permiso | null
    cuerpo?: VC
    /** el cuerpo llega como `multipart/form-data` (con archivos) en vez de JSON */
    multipart?: CuerpoMultipart
    query?: VQ
    /** schemas de parámetros de ruta; por defecto `:id` y `:xxxId` son enteros positivos */
    parametros?: Record<string, EsquemaJson>
    respuesta: RespuestaRuta
    /** acepta `Idempotency-Key` */
    idempotente?: boolean
    /** la edición exige `version` y puede responder 409 */
    versionada?: boolean
    /**
     * Con `seguridad: 'sesion'` y `permiso: null`: también responde a un nodo portal remoto con su
     * `X-Argos-Nodo-Token` válido, sin sesión (contrato `nodo-portal.md`; hoy solo `GET /version`).
     */
    nodoPortal?: boolean
    /** tiene límite de peticiones y puede responder 429 con `Retry-After` */
    limitada?: boolean
    /**
     * Gancho que corre después de autenticar, autorizar e idempotencia, pero **antes** de validar
     * cuerpo y query con VineJS. Para el límite de peticiones: un cuerpo inválido (422) también
     * consume el cupo. Si lanza, ni se valida ni corre el handler.
     */
    antes?: (ctx: HttpContext) => Promise<void>
    handler?: (ctx: HttpContext, entrada: EntradaHandler<Salida<VC>, Salida<VQ>>) => Promise<unknown>
}

/** Ruta ya normalizada (tipos borrados) para montar en el router y generar el OpenAPI. */
export type Ruta = DefinicionRuta<ValidadorVine | undefined, ValidadorVine | undefined>

/** Ayuda de tipos: infiere cuerpo y query del handler a partir de los validadores. */
export function definirRuta<
    VC extends ValidadorVine | undefined = undefined,
    VQ extends ValidadorVine | undefined = undefined,
>(definicion: DefinicionRuta<VC, VQ>): Ruta {
    return definicion as unknown as Ruta
}

/** Parámetros enteros por convención: `id` o terminados en `Id`. */
export function esParametroEntero(nombre: string): boolean {
    return nombre === 'id' || nombre.endsWith('Id')
}

export function parametrosDeRuta(ruta: string): string[] {
    return [...ruta.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!)
}

const REDIRECCION = Symbol('redireccion')

/** Resultado de un handler con `respuesta.status: 303`. */
export interface Redireccion {
    readonly [REDIRECCION]: string
}

/** Lo devuelve el handler de una ruta 303: `return redirigir(urlDeRetorno)`. */
export function redirigir(url: string): Redireccion {
    return { [REDIRECCION]: url }
}

const SIN_CAMBIOS = Symbol('sin_cambios')

/** Lo devuelve el handler de una ruta con `respuesta.etag` cuando `If-None-Match` coincide (304). */
export function sinCambios(): { readonly [SIN_CAMBIOS]: true } {
    return { [SIN_CAMBIOS]: true }
}

/** ¿El `If-None-Match` de la petición incluye este ETag (sin comillas)? */
export function etagCoincide(ctx: HttpContext, etag: string): boolean {
    const cabecera = ctx.request.header('if-none-match')
    if (!cabecera) return false
    if (cabecera.trim() === '*') return true
    return cabecera
        .split(',')
        .map((valor) => valor.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
        .includes(etag)
}

function esRedireccion(valor: unknown): valor is Redireccion {
    return typeof valor === 'object' && valor !== null && REDIRECCION in valor
}

export function esStatusRedireccion(status: number): boolean {
    return status >= 300 && status < 400
}

/** Ejecuta el gancho `antes`, la validación y el handler (o 501) para una ruta montada. */
export async function despachar(ruta: Ruta, ctx: HttpContext) {
    if (ruta.antes) await ruta.antes(ctx)
    // multipart: `request.body()` trae los campos de texto; los archivos van por `request.file()`
    const cuerpo = ruta.cuerpo ? await ruta.cuerpo.validate(ctx.request.body()) : undefined
    const query = ruta.query ? await ruta.query.validate(ctx.request.qs()) : undefined
    if (!ruta.handler) throw new NoImplementado(ruta.operacion)

    const resultado = await ruta.handler(ctx, { cuerpo, query, params: ctx.params })
    const { status } = ruta.respuesta
    if (esStatusRedireccion(status)) {
        if (!esRedireccion(resultado)) {
            throw new Error(`${ruta.operacion}: una ruta ${status} debe devolver redirigir(url)`)
        }
        return ctx.response.redirect().status(status).toPath(resultado[REDIRECCION])
    }
    if (
        ruta.respuesta.etag &&
        typeof resultado === 'object' &&
        resultado !== null &&
        SIN_CAMBIOS in resultado
    ) {
        ctx.response.status(304)
        return ctx.response.send('')
    }
    ctx.response.status(status)
    if (status === 204) return ctx.response.send('')
    return resultado
}
