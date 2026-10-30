import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import { Redis } from 'ioredis'
import { Dispatcher } from '../src/dispatcher.ts'
import { ClienteNasUdp } from '../src/nas.ts'
import { FuenteRedisApi, rateLimitsDeRegistro } from '../src/registro.ts'
import {
    AlmacenMemoria,
    CLAVE,
    RATE_ACTIVO,
    RATE_LIMITADO,
    SECRET,
    servicio,
    sesion,
    silencio,
    SUSPENDIDO,
    TIMEOUT_ACK_MS,
} from './ayudas.ts'
import { NasSimulado } from './nas_simulado.ts'

/**
 * Respaldo del rate-limit (semana 2, tanda 2, tarea 1): sin `aaa:user:*` en Redis, `coa` pide el
 * registro a la API interna (mismo JSON y Bearer que `aaa`) y nunca arma `subida/bajada` por su cuenta.
 * Redis real (base 2) con prefijo propio; la API es un servidor HTTP falso.
 */

const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: 2,
    maxRetriesPerRequest: null,
})
const PREFIJO = `prueba-a2-${randomBytes(4).toString('hex')}:aaa:user:`
const TOKEN = 'token-interno-de-prueba'

function registro(parcial: Record<string, unknown> = {}) {
    return {
        servicio_id: 101,
        version: 3,
        user_ppp: 'cliente-101',
        estado: 'activo',
        plan: {
            id: 1,
            subida_kbps: 5120,
            bajada_kbps: 20480,
            rate_limit: '5M/20M 10M/40M 3840k/15M 16/16 4 1280k/5M',
            rate_limit_limitado: '1M/2M 0/0 0/0 0/0 4 256k/512k',
            reuso: 4,
        },
        ...parcial,
    }
}

class ApiFalsa {
    readonly servidor: Server
    respuestas: Array<{ status: number; cuerpo?: unknown } | 'colgar'> = []
    readonly pedidos: IncomingMessage[] = []

    constructor() {
        this.servidor = createServer((req, res) => {
            this.pedidos.push(req)
            const r = this.respuestas.shift() ?? { status: 500 }
            if (r === 'colgar') return
            res.writeHead(r.status, { 'content-type': 'application/json' })
            res.end(r.cuerpo === undefined ? '{}' : JSON.stringify(r.cuerpo))
        })
    }

    async iniciar() {
        await new Promise<void>((ok) => this.servidor.listen(0, '127.0.0.1', ok))
    }

    get url() {
        return `http://127.0.0.1:${(this.servidor.address() as AddressInfo).port}/api/v1/`
    }

    cerrar() {
        this.servidor.closeAllConnections()
        this.servidor.close()
    }
}

describe('FuenteRedisApi', () => {
    const api = new ApiFalsa()
    let fuente: FuenteRedisApi

    before(() => api.iniciar())
    after(async () => {
        api.cerrar()
        const claves = await redis.keys(`${PREFIJO}*`)
        if (claves.length) await redis.del(...claves)
        redis.disconnect()
    })
    beforeEach(async () => {
        api.respuestas = []
        api.pedidos.length = 0
        await redis.del(`${PREFIJO}cliente-101`)
        fuente = new FuenteRedisApi({
            redis,
            prefijo: PREFIJO,
            api: { url: api.url, token: TOKEN, timeoutMs: 1000, reintentos: 2, esperaMs: 5 },
        })
    })

    it('con la clave en Redis no llama a la API', async () => {
        await redis.set(`${PREFIJO}cliente-101`, JSON.stringify(registro()))
        const r = await fuente.obtener(101, 'cliente-101')
        assert.deepEqual(r, {
            ok: true,
            valor: {
                rate_limit: '5M/20M 10M/40M 3840k/15M 16/16 4 1280k/5M',
                rate_limit_limitado: '1M/2M 0/0 0/0 0/0 4 256k/512k',
                reuso: 4,
                control_velocidad: 'simple',
                aplicacion: null,
                grupo: null,
            },
        })
        assert.equal(api.pedidos.length, 0)
    })

    it('sin la clave: GET internal/aaa/servicio con Bearer y la cadena completa', async () => {
        api.respuestas = [{ status: 200, cuerpo: registro() }]
        const r = await fuente.obtener(101, 'cliente-101')
        assert.equal(r.ok && r.valor.rate_limit, '5M/20M 10M/40M 3840k/15M 16/16 4 1280k/5M')
        assert.equal(api.pedidos.length, 1)
        assert.equal(api.pedidos[0]?.url, '/api/v1/internal/aaa/servicio?user_ppp=cliente-101')
        assert.equal(api.pedidos[0]?.headers.authorization, `Bearer ${TOKEN}`)
    })

    it('registro viejo sin cadenas, lápida u otro servicio en Redis: va a la API', async () => {
        for (const enRedis of [
            { ...registro(), plan: { id: 1, subida_kbps: 5120, bajada_kbps: 20480 } },
            { eliminado: true, user_ppp: 'cliente-101', servicio_id: 101, version: 9 },
            registro({ servicio_id: 999 }),
        ]) {
            await redis.set(`${PREFIJO}cliente-101`, JSON.stringify(enRedis))
            api.respuestas = [{ status: 200, cuerpo: registro() }]
            const r = await fuente.obtener(101, 'cliente-101')
            assert.equal(r.ok, true)
        }
        assert.equal(api.pedidos.length, 3)
    })

    it('5xx y timeout se reintentan con backoff; luego responde', async () => {
        api.respuestas = [{ status: 503 }, 'colgar', { status: 200, cuerpo: registro() }]
        const r = await fuente.obtener(101, 'cliente-101')
        assert.equal(r.ok, true)
        assert.equal(api.pedidos.length, 3)
    })

    it('API caída tras los reintentos, 404 o 401: error, nunca un rate-limit propio', async () => {
        api.respuestas = [{ status: 503 }, { status: 503 }, { status: 503 }]
        assert.deepEqual(await fuente.obtener(101, 'cliente-101'), {
            ok: false,
            error: 'API interna respondió 503 (3 intentos)',
        })
        api.respuestas = [{ status: 404 }]
        assert.equal((await fuente.obtener(101, 'cliente-101')).ok, false)
        api.respuestas = [{ status: 401 }]
        const r = await fuente.obtener(101, 'cliente-101')
        assert.deepEqual(r, { ok: false, error: 'API interna respondió 401' })
        // 404 y 401 no se reintentan
        assert.equal(api.pedidos.length, 5)
    })

    it('sin API configurada y sin la clave: error', async () => {
        const sinApi = new FuenteRedisApi({ redis, prefijo: PREFIJO, api: null })
        assert.equal((await sinApi.obtener(101, 'cliente-101')).ok, false)
    })

    it('rateLimitsDeRegistro exige las dos cadenas y el mismo servicio', () => {
        assert.equal(rateLimitsDeRegistro(registro(), 102), null)
        assert.equal(rateLimitsDeRegistro(null, 101), null)
        assert.deepEqual(rateLimitsDeRegistro(registro({ control_velocidad: 'arbol_pcq' }), 101), {
            rate_limit: '5M/20M 10M/40M 3840k/15M 16/16 4 1280k/5M',
            rate_limit_limitado: '1M/2M 0/0 0/0 0/0 4 256k/512k',
            reuso: 4,
            control_velocidad: 'arbol_pcq',
            aplicacion: null,
            grupo: null,
        })
        // Con la estrategia por capas (control-velocidad.md §7) trae la aplicación y el perfil.
        const conVelocidad = {
            ...registro(),
            velocidad: { aplicacion: 'perfil_ppp', grupo: 'plan-3', rate_limit: false, rate_limit_limitado: true },
        }
        const r = rateLimitsDeRegistro(conVelocidad, 101)!
        assert.equal(r.aplicacion, 'perfil_ppp')
        assert.equal(r.grupo, 'plan-3')
    })
})

describe('Dispatcher sin el rate-limit de A1', () => {
    const nas = new NasSimulado({ ip: '127.0.0.1', secret: SECRET })
    before(() => nas.iniciar())
    after(() => nas.cerrar())

    function crear(almacen: AlmacenMemoria) {
        return new Dispatcher({
            almacen,
            nas: new ClienteNasUdp(),
            claveSecretos: CLAVE,
            suspendido: SUSPENDIDO,
            puertoNas: nas.puerto,
            timeoutMs: TIMEOUT_ACK_MS,
            reintentos: 1,
            esperaMs: 10,
            log: silencio,
        })
    }

    const limitar = {
        id: 9,
        evento: 'servicio.estado_cambiado',
        payload: { servicio_id: 101, de: 'activo', a: 'limitado' },
        requestId: 'req-9',
    }

    it('no envía nada: audit.red con sin_rate_limit y coa.fallido por outbox; el duplicado no repite', async () => {
        nas.recibidos.length = 0
        const almacen = new AlmacenMemoria()
        almacen.servicios.set(
            101,
            servicio({
                estado: 'limitado',
                rate_limit_limitado: null,
                error_rate_limit: 'API interna respondió 503',
            }),
        )
        almacen.sesiones.set(101, [sesion()])
        const dispatcher = crear(almacen)
        const r = await dispatcher.procesar(limitar)
        assert.deepEqual(r.sesiones, [
            { sesion_id: 1, tipo: 'coa', resultado: 'sin_rate_limit', intentos: 0 },
        ])
        assert.equal(nas.recibidos.length, 0)
        assert.equal(almacen.red.length, 1)
        assert.deepEqual(almacen.red[0]?.respuesta, {
            resultado: 'sin_rate_limit',
            error: 'API interna respondió 503',
            final: true,
        })
        assert.deepEqual(almacen.outbox, [
            {
                payload: {
                    servicio_id: 101,
                    nas_ip: '127.0.0.1',
                    tipo: 'coa',
                    error: 'API interna respondió 503',
                },
                requestId: 'req-9',
            },
        ])
        await dispatcher.procesar(limitar)
        assert.equal(almacen.red.length, 1)
    })

    it('con la cadena de A1: el CoA lleva la cadena completa', async () => {
        nas.recibidos.length = 0
        const almacen = new AlmacenMemoria()
        almacen.servicios.set(101, servicio({ estado: 'limitado' }))
        almacen.sesiones.set(101, [sesion()])
        await crear(almacen).procesar(limitar)
        assert.equal(nas.recibidos[0]?.atributos['Mikrotik-Rate-Limit'], RATE_LIMITADO)
        assert.notEqual(RATE_LIMITADO, RATE_ACTIVO)
    })
})
