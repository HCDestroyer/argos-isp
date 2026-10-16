import { createServer as crearHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as crearHttps } from 'node:https'
import type { AddressInfo } from 'node:net'
import { RUTAS, type ObjetoRouterOS, type RutaRouterOS } from './cliente.ts'

/**
 * RouterOS falso para pruebas: servidor HTTP(S) en memoria que imita la API REST de RouterOS 7 en
 * los menús de `RUTAS`, con las rarezas que importan al cliente:
 *
 * - `GET /rest/<menú>?prop=valor` filtra por igualdad; `GET /rest/<menú>/<id>` devuelve uno.
 * - `PUT` crea y devuelve el objeto con `.id` (`*1`, `*2`… en hexadecimal); `PATCH /<id>` actualiza
 *   y devuelve el objeto; `DELETE /<id>` responde 204.
 * - Normaliza como el router: velocidades a bits (`5120k` → `5120000`), MAC en mayúsculas,
 *   `yes`/`no` → `true`/`false`, `target` con `/32`, y agrega `disabled`, `dynamic`, `invalid`.
 * - Errores como RouterOS: 401 sin credenciales válidas, 400 `no such command prefix` en un menú
 *   desconocido, 400 `failure: already have such entry` en address-list duplicada,
 *   `already have such name` en nombre repetido, 404 `no such item` en un id inexistente.
 * - Controles para pruebas: `caer()` / `levantar()` (puerto cerrado → ECONNREFUSED, mismo puerto al
 *   volver), `fallar(n, status)` (las próximas n peticiones responden ese status), `retrasoMs`,
 *   `tabla(ruta)` para leer o tocar el estado a mano, y `peticiones` con todo lo recibido.
 */

export interface PeticionRecibida {
    metodo: string
    ruta: string
    cuerpo: Record<string, string> | null
}

export interface OpcionesFalso {
    usuario?: string
    password?: string
    /** Certificado y clave en PEM para servir HTTPS */
    tls?: { cert: string; key: string }
}

const VELOCIDADES = new Set(['max-limit', 'limit-at', 'burst-limit', 'burst-threshold', 'pcq-rate'])
const MULT: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9 }

/** Propiedades obligatorias y únicas por menú (las que valida RouterOS y nos importan). */
const ESQUEMA: Record<RutaRouterOS, { requeridas: string[]; unicas: string[][] }> = {
    '/queue/simple': { requeridas: ['target'], unicas: [['name']] },
    '/queue/tree': { requeridas: ['parent'], unicas: [['name']] },
    '/queue/type': { requeridas: ['name', 'kind'], unicas: [['name']] },
    '/ip/firewall/address-list': { requeridas: ['list', 'address'], unicas: [['list', 'address']] },
    '/ip/firewall/mangle': { requeridas: ['chain', 'action'], unicas: [] },
    '/ip/dhcp-server/lease': { requeridas: ['address', 'mac-address'], unicas: [['mac-address', 'server']] },
    '/ip/arp': { requeridas: ['address', 'interface'], unicas: [['address', 'interface']] },
    '/ppp/profile': { requeridas: ['name'], unicas: [['name']] },
}

function velocidad(valor: string): string {
    return valor
        .split('/')
        .map((t) => {
            const m = /^(\d+(?:\.\d+)?)([kKMG])?$/.exec(t.trim())
            return m ? String(Math.round(Number(m[1]) * (m[2] ? MULT[m[2]]! : 1))) : t
        })
        .join('/')
}

function normalizar(ruta: RutaRouterOS, props: Record<string, string>): Record<string, string> {
    const salida: Record<string, string> = {}
    for (const [k, v] of Object.entries(props)) {
        let valor = String(v)
        if (valor === 'yes') valor = 'true'
        if (valor === 'no') valor = 'false'
        if (VELOCIDADES.has(k)) valor = velocidad(valor)
        if (k === 'mac-address') valor = valor.toUpperCase()
        if (ruta === '/queue/simple' && k === 'target') {
            valor = valor
                .split(',')
                .map((t) => (t.includes('/') ? t : `${t}/${t.includes(':') ? 128 : 32}`))
                .join(',')
        }
        salida[k] = valor
    }
    return salida
}

const VALORES_POR_DEFECTO: Partial<Record<RutaRouterOS, Record<string, string>>> = {
    '/queue/simple': { 'max-limit': '0/0', 'limit-at': '0/0', parent: 'none', priority: '8/8' },
    '/ip/dhcp-server/lease': { server: 'all', status: 'waiting' },
}

export class RouterOSFalso {
    readonly usuario: string
    readonly password: string
    readonly peticiones: PeticionRecibida[] = []
    retrasoMs = 0
    readonly #tablas = new Map<RutaRouterOS, ObjetoRouterOS[]>()
    readonly #servidor: Server
    readonly #tls: boolean
    #siguienteId = 1
    #fallos: { restantes: number; status: number; despues: boolean } = {
        restantes: 0,
        status: 500,
        despues: false,
    }
    #puerto = 0
    #arriba = false

    constructor(op: OpcionesFalso = {}) {
        this.usuario = op.usuario ?? 'argosisp'
        this.password = op.password ?? 'clave-api'
        this.#tls = Boolean(op.tls)
        const manejar = (req: IncomingMessage, res: ServerResponse) => void this.#manejar(req, res)
        this.#servidor = op.tls
            ? crearHttps({ cert: op.tls.cert, key: op.tls.key }, manejar)
            : crearHttp(manejar)
        for (const ruta of RUTAS) this.#tablas.set(ruta, [])
    }

    get url(): string {
        return `${this.#tls ? 'https' : 'http'}://127.0.0.1:${this.#puerto}`
    }

    async levantar(): Promise<void> {
        if (this.#arriba) return
        await new Promise<void>((resolver, rechazar) => {
            this.#servidor.once('error', rechazar)
            this.#servidor.listen(this.#puerto, '127.0.0.1', () => {
                this.#servidor.off('error', rechazar)
                resolver()
            })
        })
        this.#puerto = (this.#servidor.address() as AddressInfo).port
        this.#arriba = true
    }

    /** Cierra el puerto (las conexiones nuevas reciben ECONNREFUSED). El estado se conserva. */
    async caer(): Promise<void> {
        if (!this.#arriba) return
        this.#arriba = false
        this.#servidor.closeAllConnections()
        await new Promise<void>((r) => this.#servidor.close(() => r()))
    }

    async cerrar(): Promise<void> {
        await this.caer()
    }

    /**
     * Las próximas `n` peticiones responden `status` (500 por defecto). Con `despues`, la petición
     * se ejecuta igual y solo se pierde la respuesta (un PUT que llegó pero cuyo OK no volvió).
     */
    fallar(n: number, status = 500, opciones: { despues?: boolean } = {}): void {
        this.#fallos = { restantes: n, status, despues: opciones.despues ?? false }
    }

    /** Estado del menú (referencia viva: se puede modificar a mano en una prueba). */
    tabla(ruta: RutaRouterOS): ObjetoRouterOS[] {
        return this.#tablas.get(ruta)!
    }

    /** Objetos con ese comment. */
    conComment(ruta: RutaRouterOS, comment: string): ObjetoRouterOS[] {
        return this.tabla(ruta).filter((o) => o.comment === comment)
    }

    /** Borra a mano (como una persona en Winbox). */
    borrarAMano(ruta: RutaRouterOS, predicado: (o: ObjetoRouterOS) => boolean): number {
        const tabla = this.tabla(ruta)
        const antes = tabla.length
        const quedan = tabla.filter((o) => !predicado(o))
        tabla.splice(0, tabla.length, ...quedan)
        return antes - quedan.length
    }

    /** Escrituras recibidas (PUT, PATCH, DELETE). */
    get escrituras(): PeticionRecibida[] {
        return this.peticiones.filter((p) => p.metodo !== 'GET')
    }

    async #manejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const texto = await new Promise<string>((r) => {
            const partes: Buffer[] = []
            req.on('data', (c: Buffer) => partes.push(c))
            req.on('end', () => r(Buffer.concat(partes).toString('utf8')))
        })
        if (this.retrasoMs > 0) await new Promise((r) => setTimeout(r, this.retrasoMs))
        const url = new URL(req.url ?? '/', 'http://x')
        const metodo = req.method ?? 'GET'
        let cuerpo: Record<string, string> | null = null
        if (texto) {
            try {
                cuerpo = JSON.parse(texto) as Record<string, string>
            } catch {
                return this.#error(res, 400, 'Bad Request', 'invalid JSON')
            }
        }
        this.peticiones.push({ metodo, ruta: url.pathname + url.search, cuerpo })

        const esperado = `Basic ${Buffer.from(`${this.usuario}:${this.password}`).toString('base64')}`
        if (req.headers.authorization !== esperado) return this.#error(res, 401, 'Unauthorized')
        if (this.#fallos.restantes > 0) {
            this.#fallos.restantes--
            if (!this.#fallos.despues) return this.#error(res, this.#fallos.status, 'Internal Server Error')
            // Se ejecuta y se responde el error en lugar del resultado.
            const status = this.#fallos.status
            this.#ejecutar(metodo, url, cuerpo, {
                writeHead: () => ({ end: () => {} }),
                end: () => {},
            } as unknown as ServerResponse)
            return this.#error(res, status, 'Internal Server Error')
        }
        this.#ejecutar(metodo, url, cuerpo, res)
    }

    #ejecutar(metodo: string, url: URL, cuerpo: Record<string, string> | null, res: ServerResponse): void {
        if (!url.pathname.startsWith('/rest/')) return this.#error(res, 404, 'Not Found')
        const camino = url.pathname.slice('/rest'.length)

        if (camino === '/system/resource' && metodo === 'GET') {
            return this.#json(res, 200, { 'board-name': 'falso', version: '7.24.5 (stable)', uptime: '1d' })
        }

        const ruta = RUTAS.find((r) => camino === r || camino.startsWith(`${r}/`))
        if (!ruta) return this.#error(res, 400, 'Bad Request', 'no such command prefix')
        const id = camino.length > ruta.length ? decodeURIComponent(camino.slice(ruta.length + 1)) : null
        const tabla = this.tabla(ruta)
        const indice = id === null ? -1 : tabla.findIndex((o) => o['.id'] === id)
        if (id !== null && indice < 0) return this.#error(res, 404, 'Not Found', 'no such item')

        if (metodo === 'GET') {
            if (id !== null) return this.#json(res, 200, tabla[indice])
            const filtros = [...url.searchParams.entries()]
            return this.#json(
                res,
                200,
                tabla.filter((o) => filtros.every(([k, v]) => o[k] === v)),
            )
        }
        if (metodo === 'DELETE' && id !== null) {
            tabla.splice(indice, 1)
            res.writeHead(204).end()
            return
        }
        if (metodo === 'PUT' && id === null) {
            const props = normalizar(ruta, cuerpo ?? {})
            const falta = ESQUEMA[ruta].requeridas.find((k) => !props[k])
            if (falta) return this.#error(res, 400, 'Bad Request', `failure: ${falta} not specified`)
            const conflicto = this.#conflicto(ruta, props, null)
            if (conflicto) return this.#error(res, 400, 'Bad Request', conflicto)
            const objeto: ObjetoRouterOS = {
                '.id': `*${(this.#siguienteId++).toString(16).toUpperCase()}`,
                ...VALORES_POR_DEFECTO[ruta],
                disabled: 'false',
                dynamic: 'false',
                invalid: 'false',
                ...props,
            }
            tabla.push(objeto)
            return this.#json(res, 201, objeto)
        }
        if (metodo === 'PATCH' && id !== null) {
            const props = normalizar(ruta, cuerpo ?? {})
            const actual = tabla[indice]!
            const conflicto = this.#conflicto(ruta, { ...actual, ...props } as Record<string, string>, id)
            if (conflicto) return this.#error(res, 400, 'Bad Request', conflicto)
            Object.assign(actual, props)
            return this.#json(res, 200, actual)
        }
        return this.#error(res, 400, 'Bad Request', 'no such command')
    }

    #conflicto(ruta: RutaRouterOS, props: Record<string, string>, id: string | null): string | null {
        for (const claves of ESQUEMA[ruta].unicas) {
            if (claves.some((k) => props[k] === undefined)) continue
            const repetido = this.tabla(ruta).some(
                (o) => o['.id'] !== id && claves.every((k) => o[k] === props[k]),
            )
            if (repetido) {
                return claves.length === 1 && claves[0] === 'name'
                    ? 'failure: already have such name'
                    : 'failure: already have such entry'
            }
        }
        return null
    }

    #json(res: ServerResponse, status: number, cuerpo: unknown): void {
        const json = JSON.stringify(cuerpo)
        res.writeHead(status, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(json),
        })
        res.end(json)
    }

    #error(res: ServerResponse, status: number, message: string, detail?: string): void {
        this.#json(res, status, { error: status, message, ...(detail ? { detail } : {}) })
    }
}
