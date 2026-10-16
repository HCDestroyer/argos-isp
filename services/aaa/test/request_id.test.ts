import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { ColaAccounting, RegistroAccounting } from '../src/accounting.ts'
import { crearApp } from '../src/app.ts'
import { FuenteApi, ResolutorServicios } from '../src/fuentes.ts'
import { idDerivado, idEntrante } from '../src/request_id.ts'
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

const NAS = '10.255.255.2'

describe('request_id: cabecera o derivado estable', () => {
    it('acepta X-Request-Id con el formato de la API; descarta vacío, largo o con espacios', () => {
        assert.equal(idEntrante('rad-0123abcd'), 'rad-0123abcd')
        assert.equal(idEntrante(['a:b.c_d-1', 'otro']), 'a:b.c_d-1')
        assert.equal(idEntrante(undefined), null)
        assert.equal(idEntrante(''), null)
        assert.equal(idEntrante('con espacio'), null)
        assert.equal(idEntrante('x'.repeat(129)), null)
    })

    it('mismo NAS y Acct-Session-Id → mismo id, aunque cambien el tipo o el usuario', () => {
        const a = idDerivado(
            new Map([
                ['NAS-IP-Address', NAS],
                ['Acct-Session-Id', '81a00001'],
                ['User-Name', 'u1'],
                ['Acct-Status-Type', 'Start'],
            ]),
        )
        const b = idDerivado(
            new Map([
                ['NAS-IP-Address', NAS],
                ['Acct-Session-Id', '81a00001'],
                ['Acct-Status-Type', 'Stop'],
            ]),
        )
        assert.match(String(a), /^rad-[0-9a-f]{32}$/)
        assert.equal(a, b)
        const otraSesion = idDerivado(
            new Map([
                ['NAS-IP-Address', NAS],
                ['Acct-Session-Id', '81a00002'],
            ]),
        )
        const otroNas = idDerivado(
            new Map([
                ['NAS-IP-Address', '10.0.0.9'],
                ['Acct-Session-Id', '81a00001'],
            ]),
        )
        assert.notEqual(a, otraSesion)
        assert.notEqual(a, otroNas)
    })

    it('sin Acct-Session-Id usa User-Name + NAS; sin nada no deriva', () => {
        const u1 = idDerivado(
            new Map([
                ['NAS-IP-Address', NAS],
                ['User-Name', 'u1'],
            ]),
        )
        assert.equal(
            u1,
            idDerivado(
                new Map([
                    ['NAS-IP-Address', NAS],
                    ['User-Name', 'u1'],
                ]),
            ),
        )
        assert.notEqual(
            u1,
            idDerivado(
                new Map([
                    ['NAS-IP-Address', NAS],
                    ['User-Name', 'u2'],
                ]),
            ),
        )
        assert.equal(idDerivado(new Map()), null)
    })
})

describe('request_id en aaa: logs, respuesta, respaldo a la API y accounting', () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()
    const api = new ApiFalsa()
    const lineas: Record<string, unknown>[] = []
    const encolados: RegistroAccounting[] = []
    const cola: ColaAccounting = {
        encolar: async (r) => {
            encolados.push(r)
        },
    }
    let app: ReturnType<typeof crearApp>

    before(async () => {
        await api.iniciar()
        app = crearApp({
            resolutor: new ResolutorServicios({
                redis,
                prefijo,
                respaldo: new FuenteApi({ url: api.url, token: 't', timeoutMs: 500 }),
                log: { warn: () => {} },
            }),
            claveSecretos: CLAVE,
            perfil: PERFIL,
            logLevel: 'info',
            logStream: { write: (l) => void lineas.push(JSON.parse(l) as Record<string, unknown>) },
            cola,
        })
        await app.ready()
    })

    beforeEach(async () => {
        await borrarPrefijo(redis, prefijo)
        api.respuestas.clear()
        api.llamadas.length = 0
        lineas.length = 0
        encolados.length = 0
    })

    after(async () => {
        await borrarPrefijo(redis, prefijo)
        await app.close()
        await api.cerrar()
        redis.disconnect()
    })

    function lineaAuthorize() {
        return lineas.find((l) => l.msg === 'authorize')
    }

    it('con X-Request-Id: se usa en el log, en la respuesta y en la consulta a la API', async () => {
        api.respuestas.set('u-rid', { status: 200, cuerpo: servicio({ user_ppp: 'u-rid' }) })
        const res = await app.inject({
            method: 'POST',
            url: '/aaa/authorize',
            headers: { 'x-request-id': 'rad-desde-freeradius' },
            payload: cuerpoRest({ 'User-Name': 'u-rid', 'NAS-IP-Address': NAS }),
        })
        assert.equal(res.statusCode, 200)
        assert.equal(res.headers['x-request-id'], 'rad-desde-freeradius')
        assert.equal(api.llamadas[0]?.requestId, 'rad-desde-freeradius')
        assert.equal(lineaAuthorize()?.request_id, 'rad-desde-freeradius')
    })

    it('sin cabecera: derivado del paquete, estable entre reintentos y propagado a la API', async () => {
        const cuerpo = cuerpoRest({ 'User-Name': 'u-sin', 'NAS-IP-Address': NAS, 'Acct-Session-Id': '81a0aa01' })
        const esperado = idDerivado(
            new Map([
                ['NAS-IP-Address', NAS],
                ['Acct-Session-Id', '81a0aa01'],
            ]),
        )
        const r1 = await app.inject({ method: 'POST', url: '/aaa/authorize', payload: cuerpo })
        const r2 = await app.inject({ method: 'POST', url: '/aaa/authorize', payload: cuerpo })
        assert.equal(r1.statusCode, 404)
        assert.equal(r1.headers['x-request-id'], esperado)
        assert.equal(r2.headers['x-request-id'], esperado)
        assert.deepEqual(
            api.llamadas.map((l) => l.requestId),
            [esperado, esperado],
        )
        const linea = lineaAuthorize()
        assert.equal(linea?.request_id, esperado)
        assert.equal(linea?.resultado, 'inexistente')
        // Una sola etiqueta request_id por línea (no el UUID de Fastify y el derivado a la vez).
        assert.equal(
            lineas.filter((l) => l.msg === 'authorize').every((l) => l.request_id === esperado),
            true,
        )
    })

    it('cabecera inválida: se ignora y se deriva', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/aaa/authorize',
            headers: { 'x-request-id': 'no válido' },
            payload: cuerpoRest({ 'User-Name': 'u-x', 'NAS-IP-Address': NAS }),
        })
        assert.match(String(res.headers['x-request-id']), /^rad-[0-9a-f]{32}$/)
    })

    it('accounting: el job lleva el request_id de la sesión (Start y Stop iguales)', async () => {
        const comunes = { 'User-Name': 'u-acct', 'NAS-IP-Address': NAS, 'Acct-Session-Id': '81a0bb02' }
        for (const tipo of ['Start', 'Stop']) {
            const res = await app.inject({
                method: 'POST',
                url: '/aaa/accounting',
                payload: cuerpoRest({ ...comunes, 'Acct-Status-Type': tipo }),
            })
            assert.equal(res.statusCode, 204)
        }
        const esperado = idDerivado(
            new Map([
                ['NAS-IP-Address', NAS],
                ['Acct-Session-Id', '81a0bb02'],
            ]),
        )
        assert.deepEqual(
            encolados.map((r) => r.request_id),
            [esperado, esperado],
        )
        assert.ok(lineas.filter((l) => l.msg === 'accounting').every((l) => l.request_id === esperado))
    })

    it('rutas que no son de RADIUS: UUID nuevo', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' })
        assert.match(String(res.headers['x-request-id']), /^[0-9a-f-]{36}$/)
    })
})
