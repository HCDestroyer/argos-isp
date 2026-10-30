import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Redis } from 'ioredis'
import { cifrar } from '../src/cifrado.ts'
import type { ServicioAaa } from '../src/servicio.ts'

/** Pruebas: Redis local en la base 2 con un prefijo por corrida (no toca claves reales). */
export function redisDePrueba(): Redis {
    return new Redis({
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 2,
        maxRetriesPerRequest: 1,
        lazyConnect: false,
    })
}

export function prefijoDePrueba(): string {
    return `prueba-a2-${randomBytes(4).toString('hex')}:aaa:user:`
}

export async function borrarPrefijo(redis: Redis, prefijo: string): Promise<void> {
    const claves = await redis.keys(`${prefijo}*`)
    if (claves.length > 0) await redis.del(...claves)
}

export const CLAVE = randomBytes(32)

export function servicio(
    parcial: Partial<ServicioAaa> & { user_ppp: string },
    pass = 'secreta',
): ServicioAaa {
    return {
        servicio_id: 1,
        version: 1,
        pass_ppp: cifrar(pass, CLAVE),
        estado: 'activo',
        router_id: 1,
        control_velocidad: 'simple',
        velocidad: null,
        plan: {
            id: 1,
            subida_kbps: 5120,
            bajada_kbps: 20480,
            subida_limitada_kbps: 1024,
            bajada_limitada_kbps: 2048,
            rate_limit_override: null,
            profile_ppp: null,
            rate_limit: null,
            rate_limit_limitado: null,
            reuso: 1,
        },
        ipv4: { modo: 'estatico', ip: '10.10.1.10' },
        ipv6: {
            modo: 'radius_servicio',
            prefijo_enlace: '2001:db8:101:1::/64',
            prefijo_delegado: '2001:db8:300:100::/56',
        },
        ...parcial,
    }
}

export const PERFIL = {
    suspendido: {
        rateLimit: '256k/256k',
        grupo: 'suspendido',
        addressList: 'suspendidos',
        filterId: 'argos-corte.in',
    },
    interimSegundos: 300,
}

/** Cuerpo como lo arma rlm_rest (`body = 'json'`). */
export function cuerpoRest(
    atributos: Record<string, string>,
): Record<string, { type: string; value: string[] }> {
    return Object.fromEntries(Object.entries(atributos).map(([k, v]) => [k, { type: 'string', value: [v] }]))
}

/**
 * API interna simulada de A1: `GET /internal/aaa/servicio?user_ppp=` y `POST /internal/aaa/servicios
 * { user_ppp: [...] }` (lotes, mismo JSON en `data`; los que no responden 200 se omiten, como en la API).
 */
export class ApiFalsa {
    readonly llamadas: {
        metodo: string
        url: string
        auth: string | undefined
        requestId?: string
        usuarios?: string[]
    }[] = []
    respuestas = new Map<string, { status: number; cuerpo?: unknown }>()
    /** Respuesta fija para `POST /internal/aaa/servicios` (p. ej. 404 = API sin la ruta de lotes). */
    respuestaLote: { status: number; cuerpo?: unknown } | null = null
    /** true: acepta la conexión y nunca responde (API colgada → timeout de `FuenteApi`). */
    colgada = false
    private servidor: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (this.colgada) return
        const partes: Buffer[] = []
        req.on('data', (c: Buffer) => partes.push(c))
        req.on('end', () => this.responder(req, res, Buffer.concat(partes).toString('utf8')))
    })
    url = ''

    private responder(req: IncomingMessage, res: ServerResponse, cuerpo: string): void {
        const url = new URL(req.url ?? '/', 'http://x')
        const requestId = req.headers['x-request-id']
        const comun = {
            metodo: req.method ?? 'GET',
            url: url.pathname + url.search,
            auth: req.headers.authorization,
            ...(typeof requestId === 'string' ? { requestId } : {}),
        }
        let r: { status: number; cuerpo?: unknown }
        if (req.method === 'POST' && url.pathname.endsWith('/internal/aaa/servicios')) {
            const usuarios = (JSON.parse(cuerpo || '{}') as { user_ppp?: string[] }).user_ppp ?? []
            this.llamadas.push({ ...comun, usuarios })
            r = this.respuestaLote ?? {
                status: 200,
                cuerpo: {
                    data: usuarios.flatMap((u) => {
                        const e = this.respuestas.get(u)
                        return e?.status === 200 ? [e.cuerpo] : []
                    }),
                    nextCursor: null,
                },
            }
        } else {
            this.llamadas.push(comun)
            r = this.respuestas.get(url.searchParams.get('user_ppp') ?? '') ?? { status: 404 }
        }
        res.writeHead(r.status, { 'content-type': 'application/json' })
        res.end(r.cuerpo === undefined ? '' : JSON.stringify(r.cuerpo))
    }

    async iniciar(): Promise<void> {
        await new Promise<void>((resolve) => this.servidor.listen(0, '127.0.0.1', resolve))
        this.url = `http://127.0.0.1:${(this.servidor.address() as AddressInfo).port}`
    }

    async cerrar(): Promise<void> {
        this.servidor.closeAllConnections()
        await new Promise<void>((resolve) => this.servidor.close(() => resolve()))
    }
}
