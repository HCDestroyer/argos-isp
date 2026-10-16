import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { Queue } from 'bullmq'
import {
    ColaAccountingBullmq,
    NOMBRE_COLA_ACCOUNTING,
    normalizarAccounting,
    type ColaAccounting,
    type RegistroAccounting,
} from '../src/accounting.ts'
import { crearApp } from '../src/app.ts'
import { FuenteFixtures, ResolutorServicios } from '../src/fuentes.ts'
import { leerAtributos } from '../src/radius.ts'
import { CLAVE, cuerpoRest, PERFIL, prefijoDePrueba, redisDePrueba } from './ayudas.ts'

const AHORA = new Date('2026-10-15T20:00:00.000Z')

function atributos(valores: Record<string, string>) {
    return leerAtributos(cuerpoRest(valores))
}

const START = {
    'Acct-Status-Type': 'Start',
    'NAS-IP-Address': '192.0.2.1',
    'Acct-Session-Id': '81a00003',
    'User-Name': 'cliente-101',
    'Framed-IP-Address': '10.10.1.10',
    'Framed-IPv6-Prefix': '2001:db8:101:1::/64',
}

describe('normalizarAccounting', () => {
    it('Start con IPv4 y /64; sin Delegated-IPv6-Prefix (como RouterOS 7.24.5)', () => {
        const r = normalizarAccounting(atributos(START), AHORA)
        assert.deepEqual(r, {
            tipo: 'Start',
            nas_ip: '192.0.2.1',
            acct_session_id: '81a00003',
            user_ppp: 'cliente-101',
            ipv4: '10.10.1.10',
            prefijo_enlace_v6: '2001:db8:101:1::/64',
            prefijo_delegado_v6: null,
            bytes_in: '0',
            bytes_out: '0',
            duracion_s: null,
            causa_fin: null,
            evento_en: '2026-10-15T20:00:00.000Z',
        })
    })

    it('Stop: gigawords, duración, causa y Acct-Delay-Time', () => {
        const r = normalizarAccounting(
            atributos({
                ...START,
                'Acct-Status-Type': 'Stop',
                'Acct-Input-Octets': '10',
                'Acct-Input-Gigawords': '1',
                'Acct-Output-Octets': '4294967295',
                'Acct-Output-Gigawords': '2',
                'Acct-Session-Time': '3600',
                'Acct-Terminate-Cause': 'User-Request',
                'Acct-Delay-Time': '5',
                'Delegated-IPv6-Prefix': '2001:db8:300:100::/56',
            }),
            AHORA,
        )
        assert.equal(r.tipo, 'Stop')
        assert.equal(r.bytes_in, '4294967306')
        assert.equal(r.bytes_out, (4294967295n + 2n * 4294967296n).toString())
        assert.equal(r.duracion_s, 3600)
        assert.equal(r.causa_fin, 'User-Request')
        assert.equal(r.evento_en, '2026-10-15T19:59:55.000Z')
        assert.equal(r.prefijo_delegado_v6, '2001:db8:300:100::/56')
    })

    it('Acct-Status-Type numérico, Event-Timestamp y valores inválidos descartados', () => {
        const r = normalizarAccounting(
            atributos({
                ...START,
                'Acct-Status-Type': '3',
                'Event-Timestamp': '1792094400',
                'Framed-IP-Address': '2001:db8::1',
                'Framed-IPv6-Prefix': 'no-es-prefijo',
            }),
            AHORA,
        )
        assert.equal(r.tipo, 'Interim-Update')
        assert.equal(r.evento_en, new Date(1792094400 * 1000).toISOString())
        assert.equal(r.ipv4, null)
        assert.equal(r.prefijo_enlace_v6, null)
    })

    it('Accounting-On no exige sesión ni usuario', () => {
        const r = normalizarAccounting(
            atributos({ 'Acct-Status-Type': 'Accounting-On', 'NAS-IP-Address': '192.0.2.1' }),
            AHORA,
        )
        assert.equal(r.tipo, 'Accounting-On')
        assert.equal(r.acct_session_id, '')
    })

    it('rechaza tipos desconocidos, sin NAS o sin sesión', () => {
        assert.throws(() => normalizarAccounting(atributos({ ...START, 'Acct-Status-Type': 'Failed' })))
        const sinNas: Record<string, string> = { ...START }
        delete sinNas['NAS-IP-Address']
        assert.throws(() => normalizarAccounting(atributos(sinNas)))
        assert.throws(() => normalizarAccounting(atributos({ ...START, 'Acct-Session-Id': '' })))
    })
})

class ColaFalsa implements ColaAccounting {
    readonly encolados: RegistroAccounting[] = []
    fallar = false
    colgar = false
    async encolar(r: RegistroAccounting): Promise<void> {
        if (this.colgar) return new Promise(() => {})
        if (this.fallar) throw new Error('Redis caído')
        this.encolados.push(r)
    }
}

describe('POST /aaa/accounting', () => {
    const redis = redisDePrueba()
    let app: ReturnType<typeof crearApp>
    const cola = new ColaFalsa()

    before(async () => {
        const fuente = await FuenteFixtures.desdeArchivo(
            fileURLToPath(new URL('../fixtures/servicios.json', import.meta.url)),
            CLAVE,
        )
        app = crearApp({
            resolutor: new ResolutorServicios({
                redis,
                prefijo: prefijoDePrueba(),
                respaldo: fuente,
                log: { warn: () => {} },
            }),
            claveSecretos: CLAVE,
            perfil: PERFIL,
            logLevel: 'silent',
            cola,
            encolarTimeoutMs: 200,
        })
        await app.ready()
    })

    after(async () => {
        await app.close()
        redis.disconnect()
    })

    it('encola y responde 204', async () => {
        const res = await app.inject({ method: 'POST', url: '/aaa/accounting', payload: cuerpoRest(START) })
        assert.equal(res.statusCode, 204)
        assert.equal(cola.encolados.length, 1)
        assert.equal(cola.encolados[0]?.acct_session_id, '81a00003')
    })

    it('paquete inservible → 204 sin encolar (el NAS no lo reintenta)', async () => {
        const antes = cola.encolados.length
        const res = await app.inject({
            method: 'POST',
            url: '/aaa/accounting',
            payload: cuerpoRest({ 'Acct-Status-Type': 'Start', 'NAS-IP-Address': '192.0.2.1' }),
        })
        assert.equal(res.statusCode, 204)
        assert.equal(cola.encolados.length, antes)
    })

    it('cola caída o colgada → 503 (sin Accounting-Response: el NAS reintenta)', async () => {
        cola.fallar = true
        const caida = await app.inject({ method: 'POST', url: '/aaa/accounting', payload: cuerpoRest(START) })
        assert.equal(caida.statusCode, 503)
        cola.fallar = false
        cola.colgar = true
        const colgada = await app.inject({
            method: 'POST',
            url: '/aaa/accounting',
            payload: cuerpoRest(START),
        })
        assert.equal(colgada.statusCode, 503)
        cola.colgar = false
    })
})

describe('ColaAccountingBullmq (Redis real, base 2, prefijo propio)', () => {
    const prefijo = `prueba-a2-${randomBytes(4).toString('hex')}`
    const conexion = {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 2,
    }
    let cola: ColaAccountingBullmq
    let lector: Queue

    before(() => {
        cola = new ColaAccountingBullmq({ conexion: { ...conexion, enableOfflineQueue: false }, prefijo })
        lector = new Queue(NOMBRE_COLA_ACCOUNTING, { connection: conexion, prefix: prefijo })
    })

    after(async () => {
        await lector.obliterate({ force: true })
        await lector.close()
        await cola.cerrar()
    })

    it('deja el job con el registro y sus reintentos', async () => {
        await cola.cola.waitUntilReady()
        const registro = normalizarAccounting(atributos(START), AHORA)
        await cola.encolar(registro)
        const [job] = await lector.getJobs(['waiting'])
        assert.ok(job)
        assert.equal(job.name, 'Start')
        assert.deepEqual(job.data, registro)
        assert.equal(job.opts.attempts, 8)
    })

    it('paquetes simultáneos salen en un lote (addBulk) y cada uno queda como job', async () => {
        await lector.obliterate({ force: true })
        const base = normalizarAccounting(atributos(START), AHORA)
        const registros = Array.from({ length: 50 }, (_, i) => ({ ...base, acct_session_id: `lote-${i}` }))
        const addBulk = cola.cola.addBulk.bind(cola.cola)
        let lotes = 0
        cola.cola.addBulk = (jobs) => {
            lotes++
            return addBulk(jobs)
        }
        try {
            await Promise.all(registros.map((r) => cola.encolar(r)))
        } finally {
            cola.cola.addBulk = addBulk
        }
        assert.equal(lotes, 1)
        const jobs = await lector.getJobs(['waiting'])
        assert.deepEqual(
            jobs.map((j) => j.data.acct_session_id).sort(),
            registros.map((r) => r.acct_session_id).sort(),
        )
        assert.ok(jobs.every((j) => j.opts.attempts === 8))
    })

    it('si el lote falla, todos los paquetes del lote fallan (el NAS los reintenta)', async () => {
        const base = normalizarAccounting(atributos(START), AHORA)
        const addBulk = cola.cola.addBulk.bind(cola.cola)
        cola.cola.addBulk = async () => {
            throw new Error('Redis caído')
        }
        try {
            const r = await Promise.allSettled([
                cola.encolar(base),
                cola.encolar({ ...base, acct_session_id: 'x' }),
            ])
            assert.deepEqual(
                r.map((x) => x.status),
                ['rejected', 'rejected'],
            )
        } finally {
            cola.cola.addBulk = addBulk
        }
    })
})
