import { Agent as AgenteHttp, request as solicitudHttp, type IncomingMessage } from 'node:http'
import { Agent as AgenteHttps, request as solicitudHttps } from 'node:https'
import {
    ErrorRouterOS,
    RouterOSCredenciales,
    RouterOSInalcanzable,
    RouterOSRespuesta,
    RouterOSSolicitud,
} from '#network/routeros/errores'
import { diferencias } from '#network/routeros/normalizar'

/**
 * Cliente de la API REST de RouterOS 7 (`/rest/...`), reutilizable por `coa` y por A6.
 *
 * - Autenticación Basic con el usuario de la API y la contraseña ya descifrada (`v1`, ver
 *   `desdeRouter` en `router.ts`). HTTPS con verificación de certificado configurable por router.
 * - Timeout por petición y reintentos con backoff (0,5 s · 1 s · 2 s) solo ante errores de red o 5xx.
 *   401/403 y 400 son definitivos y llegan como errores tipados (`errores.ts`).
 * - Operaciones idempotentes por `comment` (`argosisp:…`): `asegurar` busca, crea o corrige solo lo que
 *   difiere (y borra duplicados); `borrar` elimina todo lo que lleve ese comment. Un reintento repite
 *   la búsqueda, así que un PUT que llegó pero cuya respuesta se perdió no crea un duplicado.
 * - Cada escritura (PUT, PATCH, DELETE), con cada intento y la respuesta del equipo, se entrega a la
 *   `Bitacora` (en `coa`, una fila de `audit.red` con `tipo = 'routeros'`). Las lecturas no se auditan.
 */

/** Menús que ArgosIsp administra. Cualquier otro se rechaza antes de llegar al router. */
export const RUTAS = [
    '/queue/simple',
    '/queue/tree',
    '/queue/type',
    '/ip/firewall/address-list',
    '/ip/firewall/mangle',
    '/ipv6/firewall/address-list',
    '/ipv6/firewall/mangle',
    '/ip/dhcp-server/lease',
    '/ip/arp',
    '/ppp/profile',
] as const
export type RutaRouterOS = (typeof RUTAS)[number]

/**
 * Menús que ArgosIsp solo lee (nunca escribe): bindings de DHCPv6-PD para conocer el prefijo que
 * el router delegó a una sesión PPPoE en modo `radius_pool`, las sesiones PPP activas y los clientes
 * RADIUS del router (`routers.probar_conexion`).
 */
export const RUTAS_LECTURA = ['/ipv6/dhcp-server/binding', '/ppp/active', '/radius'] as const
export type RutaLectura = (typeof RUTAS_LECTURA)[number]

/** Un objeto tal como lo devuelve RouterOS: todas las propiedades son texto. */
export interface ObjetoRouterOS {
    '.id': string
    comment?: string
    [propiedad: string]: string | undefined
}

export type Propiedades = Record<string, string>

export interface TlsRouter {
    /** false solo para routers con certificado autofirmado sin CA conocida (laboratorio). */
    verificar: boolean
    /** CA en PEM con la que se verifica el certificado del router (autofirmado o CA propia). */
    ca?: string
}

export interface ConexionRouterOS {
    routerId: number | null
    /** Base `https://host[:puerto]` (sin `/rest`). */
    url: string
    usuario: string
    password: string
    tls?: TlsRouter
    timeoutMs?: number
    /** Reintentos tras el primer intento (por defecto 3) */
    reintentos?: number
    /** Espera base del backoff en ms (por defecto 500) */
    esperaMs?: number
}

/** Quién pide la escritura: va al `comando` de `audit.red`. */
export interface ContextoRed {
    servicio_id?: number | null
    evento_id?: string | null
    request_id?: string | null
    motivo?: string
}

export interface FilaRouterOS {
    tipo: 'routeros'
    router_id: number | null
    servicio_id: number | null
    comando: Record<string, unknown>
    respuesta: Record<string, unknown>
    ok: boolean
}

export interface Bitacora {
    registrar(fila: FilaRouterOS): Promise<void>
}

/**
 * Aviso de que el router respondió bien (2xx): `Router.en_linea` (`contactoRouterOS` de
 * `#network/sesiones/contacto`). No debe lanzar; se espera antes de devolver la respuesta.
 */
export type ContactoRouter = (routerId: number) => Promise<void>

export interface ResultadoAsegurar {
    accion: 'creado' | 'actualizado' | 'sin_cambios'
    objeto: ObjetoRouterOS
    /** Objetos sobrantes con el mismo comment que se borraron */
    duplicados: number
}

interface RespuestaHttp {
    status: number
    cuerpo: unknown
    rttMs: number
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function esRuta(ruta: string): ruta is RutaRouterOS {
    return (RUTAS as readonly string[]).includes(ruta)
}

export class ClienteRouterOS {
    readonly routerId: number | null
    readonly #base: URL
    readonly #auth: string
    readonly #timeoutMs: number
    readonly #reintentos: number
    readonly #esperaMs: number
    readonly #agente: AgenteHttp | AgenteHttps
    readonly #bitacora: Bitacora | null
    readonly #contacto: ContactoRouter | null

    constructor(
        conexion: ConexionRouterOS,
        opciones: { bitacora?: Bitacora; contacto?: ContactoRouter | null } = {},
    ) {
        this.routerId = conexion.routerId
        this.#base = new URL(conexion.url.endsWith('/') ? conexion.url : `${conexion.url}/`)
        if (this.#base.protocol !== 'https:' && this.#base.protocol !== 'http:') {
            throw new Error(`URL de RouterOS inválida: ${conexion.url}`)
        }
        this.#auth = `Basic ${Buffer.from(`${conexion.usuario}:${conexion.password}`).toString('base64')}`
        this.#timeoutMs = conexion.timeoutMs ?? 5000
        this.#reintentos = Math.max(0, conexion.reintentos ?? 3)
        this.#esperaMs = conexion.esperaMs ?? 500
        this.#agente =
            this.#base.protocol === 'https:'
                ? new AgenteHttps({
                      keepAlive: true,
                      maxSockets: 4,
                      rejectUnauthorized: conexion.tls?.verificar ?? true,
                      ca: conexion.tls?.ca,
                  })
                : new AgenteHttp({ keepAlive: true, maxSockets: 4 })
        this.#bitacora = opciones.bitacora ?? null
        this.#contacto = opciones.contacto ?? null
    }

    /** Host del router (para logs y `audit.red`; nunca con credenciales). */
    get host(): string {
        return this.#base.host
    }

    cerrar(): void {
        this.#agente.destroy()
    }

    /** `GET /rest/system/resource`: prueba de vida y de credenciales. */
    async probar(): Promise<Record<string, unknown>> {
        return this.#conReintentos(async () => {
            const r = await this.#http('GET', 'system/resource')
            return this.#objeto(r.cuerpo, r.status) as Record<string, unknown>
        })
    }

    /** Lista un menú, opcionalmente filtrado por propiedades (`?comment=…`). */
    async listar(ruta: RutaRouterOS | RutaLectura, filtro: Propiedades = {}): Promise<ObjetoRouterOS[]> {
        return this.#conReintentos(() => this.#listar(ruta, filtro, true))
    }

    /** Objetos de un menú con ese `comment` exacto. */
    async buscar(ruta: RutaRouterOS, comment: string): Promise<ObjetoRouterOS[]> {
        return this.listar(ruta, { comment })
    }

    /**
     * Deja exactamente un objeto con ese `comment` y esas propiedades: lo crea si no existe, corrige
     * solo lo que difiere (comparación normalizada) y borra los duplicados.
     */
    async asegurar(
        ruta: RutaRouterOS,
        comment: string,
        propiedades: Propiedades,
        ctx: ContextoRed = {},
    ): Promise<ResultadoAsegurar> {
        return this.asegurarPor(ruta, { comment }, propiedades, ctx)
    }

    /**
     * Como `asegurar`, con otra clave de identidad: `{ name }` en menús sin `comment` (`/queue/type`).
     * La clave va siempre en el objeto creado.
     */
    async asegurarPor(
        ruta: RutaRouterOS,
        clave: Propiedades,
        propiedades: Propiedades,
        ctx: ContextoRed = {},
    ): Promise<ResultadoAsegurar> {
        return this.#conReintentos(async (intento) => {
            const existentes = await this.#listar(ruta, clave)
            const [primero, ...sobrantes] = existentes
            for (const sobrante of sobrantes) await this.#borrarId(ruta, sobrante, ctx, intento)
            if (!primero) {
                const objeto = await this.#escribir(
                    'PUT',
                    ruta,
                    null,
                    { ...propiedades, ...clave },
                    ctx,
                    intento,
                )
                return { accion: 'creado', objeto, duplicados: sobrantes.length }
            }
            const cambios = diferencias(propiedades, primero)
            if (Object.keys(cambios).length === 0) {
                return { accion: 'sin_cambios', objeto: primero, duplicados: sobrantes.length }
            }
            const objeto = await this.#escribir('PATCH', ruta, primero['.id'], cambios, ctx, intento, {
                antes: Object.fromEntries(Object.keys(cambios).map((k) => [k, primero[k] ?? null])),
            })
            return { accion: 'actualizado', objeto, duplicados: sobrantes.length }
        })
    }

    /** Borra todo lo que lleve ese `comment`. Devuelve cuántos objetos borró (0 si no había). */
    async borrar(ruta: RutaRouterOS, comment: string, ctx: ContextoRed = {}): Promise<number> {
        return this.borrarPor(ruta, { comment }, ctx)
    }

    /** Borra todo lo que coincida con la clave (`{ comment }` o `{ name }`). */
    async borrarPor(ruta: RutaRouterOS, clave: Propiedades, ctx: ContextoRed = {}): Promise<number> {
        return this.#conReintentos(async (intento) => {
            const existentes = await this.#listar(ruta, clave)
            for (const objeto of existentes) await this.#borrarId(ruta, objeto, ctx, intento)
            return existentes.length
        })
    }

    /**
     * Crea sin buscar antes. No se reintenta (un PUT repetido crea otro objeto): usa `asegurar`
     * salvo que el objeto no lleve comment.
     */
    async crear(
        ruta: RutaRouterOS,
        propiedades: Propiedades,
        ctx: ContextoRed = {},
    ): Promise<ObjetoRouterOS> {
        return this.#escribir('PUT', ruta, null, propiedades, ctx, 1)
    }

    async actualizar(
        ruta: RutaRouterOS,
        id: string,
        propiedades: Propiedades,
        ctx: ContextoRed = {},
    ): Promise<ObjetoRouterOS> {
        return this.#conReintentos((intento) => this.#escribir('PATCH', ruta, id, propiedades, ctx, intento))
    }

    async borrarPorId(ruta: RutaRouterOS, id: string, ctx: ContextoRed = {}): Promise<void> {
        await this.#conReintentos((intento) => this.#borrarId(ruta, { '.id': id }, ctx, intento))
    }

    // --- internos ---

    async #conReintentos<T>(fn: (intento: number) => Promise<T>): Promise<T> {
        const maximo = 1 + this.#reintentos
        for (let intento = 1; ; intento++) {
            try {
                return await fn(intento)
            } catch (e) {
                if (!(e instanceof ErrorRouterOS) || !e.reintentable || intento >= maximo) throw e
                await dormir(this.#esperaMs * 2 ** (intento - 1))
            }
        }
    }

    async #listar(
        ruta: RutaRouterOS | RutaLectura,
        filtro: Propiedades,
        lectura = false,
    ): Promise<ObjetoRouterOS[]> {
        if (!(lectura && (RUTAS_LECTURA as readonly string[]).includes(ruta))) this.#validarRuta(ruta)
        const consulta = new URLSearchParams(filtro).toString()
        const r = await this.#http('GET', `${ruta.slice(1)}${consulta ? `?${consulta}` : ''}`)
        if (!Array.isArray(r.cuerpo)) {
            throw new RouterOSRespuesta(`GET ${ruta}: se esperaba una lista`, r.status)
        }
        return r.cuerpo as ObjetoRouterOS[]
    }

    async #borrarId(
        ruta: RutaRouterOS,
        objeto: Pick<ObjetoRouterOS, '.id'> & Partial<ObjetoRouterOS>,
        ctx: ContextoRed,
        intento: number,
    ): Promise<void> {
        const antes: Record<string, unknown> = { ...objeto }
        delete antes['.id']
        try {
            await this.#escribir('DELETE', ruta, objeto['.id'], null, ctx, intento, {
                antes: Object.keys(antes).length > 0 ? antes : undefined,
            })
        } catch (e) {
            // Ya no existe (lo borró otro intento o una persona): el resultado es el deseado.
            if (e instanceof RouterOSSolicitud && e.status === 404) return
            throw e
        }
    }

    async #escribir(
        metodo: 'PUT' | 'PATCH' | 'DELETE',
        ruta: RutaRouterOS,
        id: string | null,
        propiedades: Propiedades | null,
        ctx: ContextoRed,
        intento: number,
        extra: { antes?: unknown } = {},
    ): Promise<ObjetoRouterOS> {
        this.#validarRuta(ruta)
        const camino = id ? `${ruta.slice(1)}/${encodeURIComponent(id)}` : ruta.slice(1)
        const comando: Record<string, unknown> = {
            metodo,
            ruta,
            id,
            propiedades,
            host: this.host,
            intento,
            ...(extra.antes !== undefined ? { antes: extra.antes } : {}),
            ...(ctx.evento_id ? { evento_id: ctx.evento_id } : {}),
            ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
            ...(ctx.motivo ? { motivo: ctx.motivo } : {}),
        }
        const registrar = async (respuesta: Record<string, unknown>, ok: boolean) => {
            await this.#bitacora?.registrar({
                tipo: 'routeros',
                router_id: this.routerId,
                servicio_id: ctx.servicio_id ?? null,
                comando,
                respuesta,
                ok,
            })
        }
        let r: RespuestaHttp
        try {
            r = await this.#http(metodo, camino, propiedades ?? undefined)
        } catch (e) {
            const error = e as ErrorRouterOS
            await registrar(
                {
                    status: error.status ?? null,
                    error: error.message,
                    tipo_error: error.tipo ?? 'inalcanzable',
                    ...(error instanceof RouterOSSolicitud ? { detalle: error.detalle } : {}),
                    reintentable: error.reintentable ?? false,
                },
                false,
            )
            throw e
        }
        const objeto =
            metodo === 'DELETE' ? { '.id': id ?? '' } : (this.#objeto(r.cuerpo, r.status) as ObjetoRouterOS)
        await registrar(
            { status: r.status, objeto: metodo === 'DELETE' ? null : objeto, rtt_ms: r.rttMs },
            true,
        )
        return objeto
    }

    #validarRuta(ruta: string): void {
        if (!esRuta(ruta)) throw new Error(`ruta de RouterOS no administrada por ArgosIsp: ${ruta}`)
    }

    #objeto(cuerpo: unknown, status: number): Record<string, unknown> {
        if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
            throw new RouterOSRespuesta('se esperaba un objeto JSON', status)
        }
        return cuerpo as Record<string, unknown>
    }

    #http(metodo: string, camino: string, cuerpo?: Propiedades): Promise<RespuestaHttp> {
        return this.#peticion(metodo, camino, cuerpo).then(
            async (respuesta) => {
                if (this.#contacto && this.routerId !== null) await this.#contacto(this.routerId)
                return respuesta
            },
            (error: unknown) => {
                if (error instanceof ErrorRouterOS && error.operacion === null) {
                    error.operacion = operacionLegible(metodo, camino)
                }
                throw error
            },
        )
    }

    #peticion(metodo: string, camino: string, cuerpo?: Propiedades): Promise<RespuestaHttp> {
        const url = new URL(`rest/${camino}`, this.#base)
        const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
        const inicio = performance.now()
        const solicitar = url.protocol === 'https:' ? solicitudHttps : solicitudHttp
        return new Promise<RespuestaHttp>((resolver, rechazar) => {
            const req = solicitar(
                url,
                {
                    method: metodo,
                    agent: this.#agente,
                    headers: {
                        authorization: this.#auth,
                        accept: 'application/json',
                        ...(datos !== undefined
                            ? {
                                  'content-type': 'application/json',
                                  'content-length': Buffer.byteLength(datos),
                              }
                            : {}),
                    },
                    timeout: this.#timeoutMs,
                },
                (res) => {
                    leer(res).then((texto) => {
                        const rttMs = Math.round(performance.now() - inicio)
                        try {
                            resolver(interpretar(metodo, camino, res.statusCode ?? 0, texto, rttMs))
                        } catch (e) {
                            rechazar(e)
                        }
                    }, rechazar)
                },
            )
            req.on('timeout', () => {
                req.destroy(
                    Object.assign(new Error(`sin respuesta en ${this.#timeoutMs} ms`), { code: 'ETIMEDOUT' }),
                )
            })
            req.on('error', (e: NodeJS.ErrnoException) => {
                rechazar(
                    new RouterOSInalcanzable(
                        `${metodo} ${url.host}/rest/${camino}: ${e.message}`,
                        e.code ?? null,
                    ),
                )
            })
            req.end(datos)
        })
    }
}

const VERBOS: Record<string, string> = { GET: 'print', PUT: 'add', PATCH: 'set', DELETE: 'remove' }

/** `queue/simple/*1A?x=y` + `PATCH` → `queue/simple set` (va tal cual en `routeros.fallido`). */
export function operacionLegible(metodo: string, camino: string): string {
    const base = camino
        .split('?')[0]!
        .split('/')
        .filter((parte) => parte !== '' && !parte.startsWith('*') && !parte.startsWith('%2A'))
        .join('/')
    return `${base} ${VERBOS[metodo] ?? metodo.toLowerCase()}`
}

function leer(res: IncomingMessage): Promise<string> {
    return new Promise((resolver, rechazar) => {
        const partes: Buffer[] = []
        res.on('data', (c: Buffer) => partes.push(c))
        res.on('end', () => resolver(Buffer.concat(partes).toString('utf8')))
        res.on('error', rechazar)
    })
}

function interpretar(
    metodo: string,
    camino: string,
    status: number,
    texto: string,
    rttMs: number,
): RespuestaHttp {
    let cuerpo: unknown = null
    if (texto.length > 0) {
        try {
            cuerpo = JSON.parse(texto)
        } catch {
            if (status < 400) throw new RouterOSRespuesta(`${metodo} ${camino}: respuesta no JSON`, status)
        }
    }
    if (status >= 200 && status < 300) return { status, cuerpo, rttMs }
    const error = (cuerpo ?? {}) as { message?: unknown; detail?: unknown }
    const mensaje = typeof error.message === 'string' ? error.message : `HTTP ${status}`
    const detalle = typeof error.detail === 'string' ? error.detail : ''
    if (status === 401 || status === 403) throw new RouterOSCredenciales(status, mensaje)
    if (status >= 500) throw new RouterOSInalcanzable(`${metodo} ${camino}: ${mensaje}`, null, status)
    throw new RouterOSSolicitud(status, mensaje, detalle)
}
