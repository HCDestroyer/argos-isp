import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { Redis } from 'ioredis'
import env from '#start/env'
import { unico } from '#tests/ayudas'
import { parsearNodos, sondeoHttp, VigiaAaa, type Sondeo } from '#network/sesiones/vigia_aaa'

/**
 * Tarea 9 de A2: vigía de `aaa` → `aaa.caido` / `aaa.recuperado` por outbox, con lock.
 * Redis real con prefijo propio; reloj y sondeo inyectados (salvo la prueba de `sondeoHttp`).
 */

const PREFIJO = `a2test-${randomUUID().slice(0, 8)}`

class Reloj {
    constructor(public ms = Date.parse('2026-10-16T12:00:00Z')) {}
    ahora = () => new Date(this.ms)
    avanzar(ms: number) {
        this.ms += ms
    }
}

/** Sondeo controlable: `caidos` lanza con el error dado. */
function sondeoFalso() {
    const caidos = new Map<string, string>()
    const sondear: Sondeo = async (url) => {
        const error = caidos.get(url)
        if (error) throw new Error(error)
    }
    return { caidos, sondear }
}

async function nodos(v: VigiaAaa) {
    const r = await v.vuelta()
    return r.nodos
}

async function eventoDe(v: VigiaAaa) {
    const r = await v.vuelta()
    return r.nodos[0]?.evento
}

async function activo(v: VigiaAaa) {
    const r = await v.vuelta()
    return r.activo
}

async function eventos(nodo: string) {
    return db
        .from('audit.outbox')
        .whereIn('evento', ['aaa.caido', 'aaa.recuperado'])
        .whereRaw(`payload->>'nodo' = ?`, [nodo])
        .orderBy('id')
        .select('evento', 'payload')
}

test.group('network · vigía de aaa (tarea 9)', (group) => {
    let redis: Redis

    group.setup(() => {
        redis = new Redis({ host: env.get('REDIS_HOST') ?? '127.0.0.1', port: env.get('REDIS_PORT') ?? 6379 })
        return async () => {
            const claves = await redis.keys(`${PREFIJO}-*`)
            if (claves.length > 0) await redis.del(...claves)
            redis.disconnect()
        }
    })

    function vigia(nodo: string, reloj: Reloj, sondear: Sondeo) {
        return new VigiaAaa({
            nodos: [{ nombre: nodo, url: `http://${nodo}.invalid:3100` }],
            caidoTrasMs: 60_000,
            conexion: redis,
            // prefijo por nodo: cada prueba tiene su propio lock
            prefijo: `${PREFIJO}-${nodo}`,
            ahora: reloj.ahora,
            sondear,
        })
    }

    test('60 s sin responder → un aaa.caido con desde y ultimo_error; al volver, aaa.recuperado', async ({
        assert,
    }) => {
        const nodo = unico('aaa')
        const reloj = new Reloj()
        const s = sondeoFalso()
        const v = vigia(nodo, reloj, s.sondear)
        const url = `http://${nodo}.invalid:3100`
        const inicio = reloj.ahora().toISOString()

        assert.deepEqual(await nodos(v), [{ nodo, ok: true, evento: null }])

        s.caidos.set(url, 'ECONNREFUSED')
        await v.vuelta()
        reloj.avanzar(30_000)
        s.caidos.set(url, 'sin respuesta en 2000 ms')
        assert.deepEqual(await nodos(v), [{ nodo, ok: false, evento: null }])
        assert.lengthOf(await eventos(nodo), 0, 'antes de 60 s no hay alerta')

        reloj.avanzar(30_000)
        assert.deepEqual(await nodos(v), [{ nodo, ok: false, evento: 'aaa.caido' }])
        reloj.avanzar(5000)
        assert.equal(await eventoDe(v), null, 'una sola alerta por caída')

        const [caido] = await eventos(nodo)
        assert.equal(caido.evento, 'aaa.caido')
        assert.deepEqual(caido.payload, { nodo, desde: inicio, ultimo_error: 'sin respuesta en 2000 ms' })

        s.caidos.delete(url)
        reloj.avanzar(5000)
        assert.equal(await eventoDe(v), 'aaa.recuperado')
        assert.equal(await eventoDe(v), null)
        const lista = await eventos(nodo)
        assert.deepEqual(
            lista.map((e) => e.evento),
            ['aaa.caido', 'aaa.recuperado'],
        )
        assert.deepEqual(lista[1].payload, {
            nodo,
            desde: inicio,
            hasta: reloj.ahora().toISOString(),
            ultimo_error: 'sin respuesta en 2000 ms',
        })
        assert.equal(await redis.exists(v.claveRacha(nodo)), 0, 'la racha se borra al recuperarse')

        const acciones = await db
            .from('audit.acciones')
            .whereIn('accion', ['aaa.registrar_caida', 'aaa.registrar_recuperacion'])
            .whereRaw(`entrada->>'nodo' = ?`, [nodo])
            .orderBy('id')
            .select('accion', 'canal', 'actor_tipo', 'resultado')
        assert.deepEqual(acciones, [
            { accion: 'aaa.registrar_caida', canal: 'cron', actor_tipo: 'sistema', resultado: 'ok' },
            { accion: 'aaa.registrar_recuperacion', canal: 'cron', actor_tipo: 'sistema', resultado: 'ok' },
        ])
    })

    test('un fallo corto que se recupera antes de 60 s no emite nada', async ({ assert }) => {
        const nodo = unico('aaa')
        const reloj = new Reloj()
        const s = sondeoFalso()
        const v = vigia(nodo, reloj, s.sondear)
        s.caidos.set(`http://${nodo}.invalid:3100`, 'HTTP 503')
        await v.vuelta()
        reloj.avanzar(50_000)
        await v.vuelta()
        s.caidos.clear()
        await v.vuelta()
        s.caidos.set(`http://${nodo}.invalid:3100`, 'HTTP 503')
        reloj.avanzar(50_000)
        await v.vuelta()
        assert.lengthOf(await eventos(nodo), 0, 'la racha empieza de nuevo tras un health check bueno')
    })

    test('dos vigías: solo el que tiene el lock sondea; si cae, el otro sigue la misma racha', async ({
        assert,
    }) => {
        const nodo = unico('aaa')
        const reloj = new Reloj()
        const s = sondeoFalso()
        s.caidos.set(`http://${nodo}.invalid:3100`, 'ECONNREFUSED')
        const a = vigia(nodo, reloj, s.sondear)
        const b = vigia(nodo, reloj, s.sondear)

        assert.isTrue(await activo(a))
        assert.isFalse(await activo(b))

        reloj.avanzar(40_000)
        await a.vuelta()
        await a.soltarLock() // el vigía A se detiene
        reloj.avanzar(20_000)
        const r = await b.vuelta()
        assert.isTrue(r.activo)
        assert.equal(r.nodos[0]!.evento, 'aaa.caido', 'B cuenta desde el primer fallo que vio A')

        // B pierde la racha (p. ej. Redis se vació): la caída ya registrada no se duplica
        await redis.del(b.claveRacha(nodo))
        reloj.avanzar(120_000)
        await b.vuelta()
        reloj.avanzar(60_000)
        await b.vuelta()
        assert.lengthOf(await eventos(nodo), 1)

        // y la recuperación sale aunque la racha se haya perdido
        s.caidos.clear()
        assert.equal(await eventoDe(b), 'aaa.recuperado')
        await b.soltarLock()
    })

    test('sondeoHttp: 2xx ok; 503, conexión rechazada y timeout fallan con un error legible', async ({
        assert,
    }) => {
        let estado = 200
        let colgar = false
        const servidor: Server = createServer((_req, res) => {
            if (colgar) return
            res.writeHead(estado, { 'content-type': 'application/json' }).end('{"status":"ok"}')
        })
        await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
        const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
        try {
            await sondeoHttp(url, 500)
            estado = 503
            await assert.rejects(() => sondeoHttp(url, 500), 'HTTP 503')
            colgar = true
            await assert.rejects(() => sondeoHttp(url, 200), 'sin respuesta en 200 ms')
        } finally {
            servidor.closeAllConnections()
            await new Promise((r) => servidor.close(r))
        }
        await assert.rejects(() => sondeoHttp(url, 500), 'ECONNREFUSED')
    })

    test('parsearNodos', ({ assert }) => {
        assert.deepEqual(parsearNodos('aaa-1=http://aaa:3100/, aaa-2=http://10.0.0.2:3100'), [
            { nombre: 'aaa-1', url: 'http://aaa:3100' },
            { nombre: 'aaa-2', url: 'http://10.0.0.2:3100' },
        ])
        assert.deepEqual(parsearNodos('http://aaa:3100'), [{ nombre: 'aaa:3100', url: 'http://aaa:3100' }])
        assert.deepEqual(parsearNodos(''), [])
        assert.throws(() => parsearNodos('aaa=no-es-url'))
    })
})
