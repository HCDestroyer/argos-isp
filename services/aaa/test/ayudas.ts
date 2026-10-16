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

/** API interna simulada de A1 (`GET /internal/aaa/servicio`). */
export class ApiFalsa {
    readonly llamadas: { url: string; auth: string | undefined }[] = []
    respuestas = new Map<string, { status: number; cuerpo?: unknown }>()
    private servidor: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://x')
        this.llamadas.push({ url: url.pathname + url.search, auth: req.headers.authorization })
        const r = this.respuestas.get(url.searchParams.get('user_ppp') ?? '') ?? { status: 404 }
        res.writeHead(r.status, { 'content-type': 'application/json' })
        res.end(r.cuerpo === undefined ? '' : JSON.stringify(r.cuerpo))
    })
    url = ''

    async iniciar(): Promise<void> {
        await new Promise<void>((resolve) => this.servidor.listen(0, '127.0.0.1', resolve))
        this.url = `http://127.0.0.1:${(this.servidor.address() as AddressInfo).port}`
    }

    async cerrar(): Promise<void> {
        await new Promise<void>((resolve) => this.servidor.close(() => resolve()))
    }
}
