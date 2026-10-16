import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { Redis } from 'ioredis'
import { crearApp } from '../src/app.ts'
import { cifrar } from '../src/cifrado.ts'
import { FuenteApi, ResolutorServicios } from '../src/fuentes.ts'
import type { ServicioAaa } from '../src/servicio.ts'
import {
    ApiFalsa,
    borrarPrefijo,
    CLAVE,
    cuerpoRest,
    PERFIL,
    prefijoDePrueba,
    redisDePrueba,
    servicio,
} from './ayudas.ts'

const silencio = { warn: () => {} }

describe('POST /aaa/authorize (Redis real + API simulada)', () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()
    const api = new ApiFalsa()
    let app: ReturnType<typeof crearApp>

    before(async () => {
        await api.iniciar()
        app = crearApp({
            resolutor: new ResolutorServicios({
                redis,
                prefijo,
                respaldo: new FuenteApi({ url: api.url, token: 'token-interno', timeoutMs: 500 }),
                log: silencio,
            }),
            claveSecretos: CLAVE,
            perfil: PERFIL,
            logLevel: 'silent',
            redisListo: () => redis.status === 'ready',
        })
        await app.ready()
    })

    beforeEach(async () => {
        await borrarPrefijo(redis, prefijo)
        api.respuestas.clear()
        api.llamadas.length = 0
    })

    after(async () => {
        await borrarPrefijo(redis, prefijo)
        await app.close()
        await api.cerrar()
        redis.disconnect()
    })

    async function autorizar(usuario: string, extra: Record<string, string> = {}) {
        const res = await app.inject({
            method: 'POST',
            url: '/aaa/authorize',
            payload: cuerpoRest({ 'User-Name': usuario, 'NAS-IP-Address': '10.255.255.2', ...extra }),
        })
        return {
            status: res.statusCode,
            cuerpo: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null,
        }
    }

    async function guardar(s: Partial<ServicioAaa> | { eliminado: true; user_ppp: string }) {
        await redis.set(`${prefijo}${s.user_ppp ?? ''}`, JSON.stringify(s))
    }

    it('activo desde Redis: contraseña descifrada, rate-limit del plan, IPv4 e IPv6, interim', async () => {
        await guardar(servicio({ user_ppp: 'u-activo' }, 'clave-1'))
        const { status, cuerpo } = await autorizar('u-activo')
        assert.equal(status, 200)
        assert.deepEqual(cuerpo, {
            'control:Cleartext-Password': 'clave-1',
            'reply:Mikrotik-Rate-Limit': '5120k/20480k',
            'reply:Framed-IP-Address': '10.10.1.10',
            'reply:Framed-IPv6-Prefix': '2001:db8:101:1::/64',
            'reply:Delegated-IPv6-Prefix': '2001:db8:300:100::/56',
            'reply:Acct-Interim-Interval': 300,
        })
        assert.equal(api.llamadas.length, 0, 'con la clave en Redis no se consulta la API')
    })

    it('limitado: rate-limit reducido del plan; pools IPv4 e IPv6 en modo radius_pool', async () => {
        await guardar(
            servicio({
                user_ppp: 'u-limitado',
                estado: 'limitado',
                ipv4: { modo: 'pool', pool: 'argos-v4-pppoe' },
                ipv6: { modo: 'radius_pool', pool_enlace: 'argos-v6-enlace', pool_delegacion: 'argos-v6-pd' },
            }),
        )
        const { status, cuerpo } = await autorizar('u-limitado')
        assert.equal(status, 200)
        assert.equal(cuerpo?.['reply:Mikrotik-Rate-Limit'], '1024k/2048k')
        assert.equal(cuerpo?.['reply:Framed-Pool'], 'argos-v4-pppoe')
        assert.equal(cuerpo?.['reply:Framed-IPv6-Pool'], 'argos-v6-enlace')
        assert.equal(cuerpo?.['reply:Mikrotik-Delegated-IPv6-Pool'], 'argos-v6-pd')
        assert.equal(cuerpo?.['reply:Delegated-IPv6-Prefix-Pool'], 'argos-v6-pd')
        assert.equal(cuerpo?.['reply:Framed-IPv6-Prefix'], undefined)
        assert.equal(cuerpo?.['reply:Delegated-IPv6-Prefix'], undefined)
        assert.equal(cuerpo?.['reply:Framed-IP-Address'], undefined)
        assert.equal(cuerpo?.['reply:Mikrotik-Address-List'], undefined)
    })

    it('arbol_pcq: sin Mikrotik-Rate-Limit ni grupo del plan (activo y limitado); el suspendido conserva su perfil', async () => {
        const plan = {
            id: 11,
            subida_kbps: 5000,
            bajada_kbps: 20000,
            subida_limitada_kbps: 1000,
            bajada_limitada_kbps: 2000,
            rate_limit_override: null,
            profile_ppp: null,
            rate_limit: '5M/20M 0/0 0/0 0/0 8 1250k/5M',
            rate_limit_limitado: '1M/2M 0/0 0/0 0/0 8 250k/500k',
            reuso: 4,
        }
        const arbol = { plan, control_velocidad: 'arbol_pcq' as const }
        await guardar(servicio({ user_ppp: 'u-arbol-activo', ...arbol }))
        await guardar(servicio({ user_ppp: 'u-arbol-limitado', estado: 'limitado', ...arbol }))
        await guardar(servicio({ user_ppp: 'u-arbol-suspendido', estado: 'suspendido', ...arbol }))
        for (const u of ['u-arbol-activo', 'u-arbol-limitado']) {
            const { cuerpo } = await autorizar(u)
            assert.equal(cuerpo?.['reply:Mikrotik-Rate-Limit'], undefined)
            assert.equal(cuerpo?.['reply:Mikrotik-Group'], undefined)
            assert.equal(cuerpo?.['reply:Framed-IP-Address'], '10.10.1.10')
        }
        const suspendido = (await autorizar('u-arbol-suspendido')).cuerpo
        assert.equal(suspendido?.['reply:Mikrotik-Rate-Limit'], '256k/256k')
        assert.equal(suspendido?.['reply:Mikrotik-Group'], 'suspendido')
    })

    it('reuso en modo simple: Mikrotik-Group = plan-<id> (activo y limitado); el suspendido conserva el suyo', async () => {
        const plan = {
            id: 9,
            subida_kbps: 5000,
            bajada_kbps: 20000,
            subida_limitada_kbps: 1000,
            bajada_limitada_kbps: 2000,
            rate_limit_override: null,
            profile_ppp: 'perfil-del-router',
            rate_limit: '5M/20M 0/0 0/0 0/0 8 1250k/5M',
            rate_limit_limitado: '1M/2M 0/0 0/0 0/0 8 250k/500k',
            reuso: 4,
        }
        await guardar(servicio({ user_ppp: 'u-reuso-activo', plan }))
        await guardar(servicio({ user_ppp: 'u-reuso-limitado', estado: 'limitado', plan }))
        await guardar(servicio({ user_ppp: 'u-reuso-suspendido', estado: 'suspendido', plan }))
        await guardar(servicio({ user_ppp: 'u-dedicado', plan: { ...plan, reuso: 1 } }))
        const grupo = async (u: string) => (await autorizar(u)).cuerpo?.['reply:Mikrotik-Group']
        assert.equal(await grupo('u-reuso-activo'), 'plan-9')
        assert.equal(await grupo('u-reuso-limitado'), 'plan-9')
        assert.equal(await grupo('u-reuso-suspendido'), 'suspendido')
        // reuso 1: sin padre, el perfil del router si lo define
        assert.equal(await grupo('u-dedicado'), 'perfil-del-router')
    })

    it('rate-limit completo de A1 (plan.rate_limit / rate_limit_limitado) tal cual', async () => {
        const plan = {
            id: 7,
            subida_kbps: 5000,
            bajada_kbps: 20000,
            subida_limitada_kbps: 1000,
            bajada_limitada_kbps: 2000,
            rate_limit_override: null,
            profile_ppp: null,
            rate_limit: '5M/20M 10M/40M 3750k/15M 16/16 2 1250k/5M',
            rate_limit_limitado: '1M/2M 0/0 0/0 0/0 2 250k/500k',
            reuso: 1,
        }
        await guardar(servicio({ user_ppp: 'u-rl-activo', plan }))
        await guardar(servicio({ user_ppp: 'u-rl-limitado', estado: 'limitado', plan }))
        assert.equal(
            (await autorizar('u-rl-activo')).cuerpo?.['reply:Mikrotik-Rate-Limit'],
            '5M/20M 10M/40M 3750k/15M 16/16 2 1250k/5M',
        )
        assert.equal(
            (await autorizar('u-rl-limitado')).cuerpo?.['reply:Mikrotik-Rate-Limit'],
            '1M/2M 0/0 0/0 0/0 2 250k/500k',
        )
    })

    it('suspendido se ACEPTA con el perfil de corte y conserva sus IPs', async () => {
        await guardar(servicio({ user_ppp: 'u-suspendido', estado: 'suspendido' }, 'clave-s'))
        const { status, cuerpo } = await autorizar('u-suspendido')
        assert.equal(status, 200)
        assert.deepEqual(cuerpo, {
            'control:Cleartext-Password': 'clave-s',
            'reply:Mikrotik-Rate-Limit': '256k/256k',
            'reply:Mikrotik-Group': 'suspendido',
            'reply:Mikrotik-Address-List': 'suspendidos',
            'reply:Filter-Id': 'argos-corte.in',
            'reply:Framed-IP-Address': '10.10.1.10',
            'reply:Framed-IPv6-Prefix': '2001:db8:101:1::/64',
            'reply:Delegated-IPv6-Prefix': '2001:db8:300:100::/56',
            'reply:Acct-Interim-Interval': 300,
        })
    })

    it('retirado → 401 (reject) sin cuerpo', async () => {
        await guardar(servicio({ user_ppp: 'u-retirado', estado: 'retirado' }))
        const { status, cuerpo } = await autorizar('u-retirado')
        assert.equal(status, 401)
        assert.equal(cuerpo, null)
    })

    it('inexistente (no está en Redis y la API da 404) → 404 y no se cachea', async () => {
        const { status } = await autorizar('u-nadie')
        assert.equal(status, 404)
        assert.equal(api.llamadas.length, 1)
        assert.equal(await redis.exists(`${prefijo}u-nadie`), 0)
    })

    it('lápida en Redis → 404 sin consultar la API', async () => {
        await guardar({ eliminado: true, user_ppp: 'u-borrado' })
        api.respuestas.set('u-borrado', { status: 200, cuerpo: servicio({ user_ppp: 'u-borrado' }) })
        const { status } = await autorizar('u-borrado')
        assert.equal(status, 404)
        assert.equal(api.llamadas.length, 0)
    })

    it('sin clave en Redis: autoriza por la API (Bearer) y cachea sin TTL', async () => {
        const s = servicio({ user_ppp: 'u-api', servicio_id: 77 }, 'clave-api')
        api.respuestas.set('u-api', { status: 200, cuerpo: s })
        const primero = await autorizar('u-api')
        assert.equal(primero.status, 200)
        assert.equal(primero.cuerpo?.['control:Cleartext-Password'], 'clave-api')
        assert.deepEqual(
            api.llamadas.map(({ url, auth }) => ({ url, auth })),
            [{ url: '/internal/aaa/servicio?user_ppp=u-api', auth: 'Bearer token-interno' }],
        )
        assert.match(String(api.llamadas[0]?.requestId), /^rad-[0-9a-f]{32}$/, 'propaga el request_id')

        const clave = `${prefijo}u-api`
        assert.deepEqual(JSON.parse((await redis.get(clave)) ?? 'null'), s)
        assert.equal(await redis.ttl(clave), -1, 'sin TTL: la invalidación es por evento')

        const segundo = await autorizar('u-api')
        assert.equal(segundo.status, 200)
        assert.equal(api.llamadas.length, 1, 'la segunda vez sale de Redis')
    })

    it('el respaldo no pisa una escritura de A1 que llegó mientras se consultaba (SET NX)', async () => {
        const resolutor = new ResolutorServicios({
            redis,
            prefijo,
            log: silencio,
            respaldo: {
                nombre: 'api',
                obtener: async (u) => {
                    // A1 publica la versión nueva entre el GET fallido y la respuesta de la API
                    await guardar(servicio({ user_ppp: u, version: 2, estado: 'suspendido' }))
                    return servicio({ user_ppp: u, version: 1 })
                },
            },
        })
        await resolutor.resolver('u-carrera')
        const guardado = JSON.parse((await redis.get(`${prefijo}u-carrera`)) ?? '{}') as {
            version: number
            estado: string
        }
        assert.equal(guardado.version, 2)
        assert.equal(guardado.estado, 'suspendido')
    })

    it('valor corrupto en Redis: autoriza por la API y no lo sobrescribe', async () => {
        await redis.set(`${prefijo}u-corrupto`, '{"estado":"desconocido"')
        api.respuestas.set('u-corrupto', { status: 200, cuerpo: servicio({ user_ppp: 'u-corrupto' }) })
        const { status } = await autorizar('u-corrupto')
        assert.equal(status, 200)
        assert.equal(await redis.get(`${prefijo}u-corrupto`), '{"estado":"desconocido"')
    })

    it('Redis sin la clave y API caída → 503 (fail → reject en FreeRADIUS)', async () => {
        api.respuestas.set('u-error', { status: 500, cuerpo: {} })
        const { status } = await autorizar('u-error')
        assert.equal(status, 503)
    })

    it('pass_ppp cifrada con otra clave → 500, nunca acepta', async () => {
        const otra = Buffer.alloc(32, 7)
        await guardar({ ...servicio({ user_ppp: 'u-otra-clave' }), pass_ppp: cifrar('x', otra) })
        const { status } = await autorizar('u-otra-clave')
        assert.equal(status, 500)
    })

    it('sin User-Name → 404', async () => {
        const res = await app.inject({ method: 'POST', url: '/aaa/authorize', payload: {} })
        assert.equal(res.statusCode, 404)
    })

    it('GET /health informa el estado de Redis', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' })
        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.json(), { status: 'ok', servicio: 'aaa', redis: 'ok' })
    })

    it('post-auth → 204; accounting sin cola configurada → 503', async () => {
        const pa = await app.inject({
            method: 'POST',
            url: '/aaa/post-auth',
            payload: cuerpoRest({ 'User-Name': 'x' }),
        })
        assert.equal(pa.statusCode, 204)
        const ac = await app.inject({
            method: 'POST',
            url: '/aaa/accounting',
            payload: cuerpoRest({
                'Acct-Status-Type': 'Start',
                'NAS-IP-Address': '192.0.2.1',
                'Acct-Session-Id': '81a00001',
                'User-Name': 'x',
            }),
        })
        assert.equal(ac.statusCode, 503)
        assert.match(ac.headers['content-type'] ?? '', /application\/problem\+json/)
    })
})

describe('Redis caído', () => {
    it('autoriza por la API sin esperar a Redis y no intenta cachear', async () => {
        const api = new ApiFalsa()
        await api.iniciar()
        // Puerto cerrado: cada comando falla de inmediato (sin cola offline).
        const redis = new Redis({
            host: '127.0.0.1',
            port: 1,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 0,
            lazyConnect: true,
        })
        redis.on('error', () => {})
        const app = crearApp({
            resolutor: new ResolutorServicios({
                redis,
                prefijo: 'aaa:user:',
                respaldo: new FuenteApi({ url: api.url, token: 't', timeoutMs: 500 }),
                log: silencio,
            }),
            claveSecretos: CLAVE,
            perfil: PERFIL,
            logLevel: 'silent',
            redisListo: () => redis.status === 'ready',
        })
        api.respuestas.set('u-sin-redis', { status: 200, cuerpo: servicio({ user_ppp: 'u-sin-redis' }, 'k') })
        try {
            const res = await app.inject({
                method: 'POST',
                url: '/aaa/authorize',
                payload: cuerpoRest({ 'User-Name': 'u-sin-redis' }),
            })
            assert.equal(res.statusCode, 200)
            assert.equal(res.json()['control:Cleartext-Password'], 'k')
            const salud = await app.inject({ method: 'GET', url: '/health' })
            assert.equal(salud.json().redis, 'caido')
        } finally {
            await app.close()
            await api.cerrar()
            redis.disconnect()
        }
    })
})
