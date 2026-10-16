import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RegistroAccounting } from '../src/accounting.ts'
import { crearApp } from '../src/app.ts'
import type { ResolutorServicios } from '../src/fuentes.ts'
import { CLAVE, cuerpoRest, PERFIL, servicio } from './ayudas.ts'

/** Tarea 5 (semana 2): `/metrics` de aaa y `request_id` por petición. */

const registros = new Map([['u-ok', servicio({ user_ppp: 'u-ok' })]])
const resolutor = {
    resolver: async (u: string) => ({ registro: registros.get(u) ?? null, origen: 'redis' as const }),
} as unknown as ResolutorServicios

function app(token?: string) {
    const encolados: RegistroAccounting[] = []
    return crearApp({
        resolutor,
        claveSecretos: CLAVE,
        perfil: PERFIL,
        logLevel: 'silent',
        redisListo: () => true,
        cola: { encolar: async (r) => void encolados.push(r) },
        metricasToken: token,
    })
}

describe('GET /metrics de aaa', () => {
    it('autorizaciones por resultado, histograma de latencia, accounting por tipo y Redis', async () => {
        const a = app()
        const autorizar = (u: string) =>
            a.inject({ method: 'POST', url: '/aaa/authorize', payload: cuerpoRest({ 'User-Name': u }) })
        assert.equal((await autorizar('u-ok')).statusCode, 200)
        assert.equal((await autorizar('u-ok')).statusCode, 200)
        assert.equal((await autorizar('nadie')).statusCode, 404)
        await a.inject({
            method: 'POST',
            url: '/aaa/accounting',
            payload: cuerpoRest({
                'Acct-Status-Type': 'Start',
                'NAS-IP-Address': '10.255.255.2',
                'Acct-Session-Id': '81a0',
                'User-Name': 'u-ok',
            }),
        })
        await a.inject({
            method: 'POST',
            url: '/aaa/accounting',
            payload: cuerpoRest({ 'Acct-Status-Type': 'Raro' }),
        })

        const res = await a.inject({ method: 'GET', url: '/metrics' })
        assert.equal(res.statusCode, 200)
        assert.match(res.headers['content-type'] as string, /^text\/plain; version=0\.0\.4/)
        const t = res.body
        assert.match(t, /argosisp_aaa_autorizaciones_total\{resultado="accept"\} 2\n/)
        assert.match(t, /argosisp_aaa_autorizaciones_total\{resultado="notfound"\} 1\n/)
        assert.match(t, /argosisp_aaa_autorizaciones_total\{resultado="reject"\} 0\n/)
        assert.match(
            t,
            /argosisp_aaa_autorizacion_duracion_segundos_bucket\{resultado="accept",le="\+Inf"\} 2\n/,
        )
        assert.match(t, /argosisp_aaa_autorizacion_duracion_segundos_count\{resultado="accept"\} 2\n/)
        assert.match(t, /argosisp_aaa_accounting_total\{tipo="Start",resultado="encolado"\} 1\n/)
        assert.match(t, /argosisp_aaa_accounting_total\{tipo="Raro",resultado="descartado"\} 1\n/)
        assert.match(t, /argosisp_aaa_redis_arriba 1\n/)
        await a.close()
    })

    it('con METRICS_TOKEN exige Bearer', async () => {
        const a = app('secreto-metricas')
        assert.equal((await a.inject({ method: 'GET', url: '/metrics' })).statusCode, 401)
        const ok = await a.inject({
            method: 'GET',
            url: '/metrics',
            headers: { authorization: 'Bearer secreto-metricas' },
        })
        assert.equal(ok.statusCode, 200)
        await a.close()
    })

    it('request_id: el de X-Request-Id o uno nuevo, devuelto en la respuesta', async () => {
        const a = app()
        const con = await a.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'req-123' } })
        assert.equal(con.headers['x-request-id'], 'req-123')
        const sin = await a.inject({ method: 'GET', url: '/health' })
        assert.match(String(sin.headers['x-request-id']), /^[0-9a-f-]{36}$/)
        await a.close()
    })
})
