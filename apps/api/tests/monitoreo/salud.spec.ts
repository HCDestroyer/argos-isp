import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import {
    estadoDisco,
    estadoGeneral,
    fijarEspacioVolumen,
    fijarFuentesSalud,
    TIMEOUT_CHEQUEO_MS,
    type Componente,
} from '#monitoreo/salud'

/** Salud del sistema (`GET /api/v1/sistema/salud`, contrato `salud.md` §2). */

const nunca = () => new Promise<never>(() => {})

function componente(cuerpo: { componentes: Componente[] }, id: string): Componente {
    const c = cuerpo.componentes.find((x) => x.id === id)
    if (!c) throw new Error(`falta el componente ${id}`)
    return c
}

test.group('monitoreo · salud del sistema', (group) => {
    group.each.teardown(() => {
        fijarFuentesSalud()
        fijarEspacioVolumen()
    })

    test('con todo arriba: núcleo ok, todos los componentes del contrato y sin 500', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(client.get('/api/v1/sistema/salud').bearerToken(token), 200)
        const cuerpo = r.body() as { estado_general: string; componentes: Componente[]; duracion_ms: number }
        for (const id of ['api', 'postgres', 'redis']) assert.equal(componente(cuerpo, id).estado, 'ok', id)
        assert.notEqual(cuerpo.estado_general, 'caido')
        const ids = cuerpo.componentes.map((c) => c.id)
        for (const id of [
            'cola.notify-envios',
            'cola.billing-cron',
            'outbox',
            'aaa',
            'coa',
            'routers',
            'cron.facturacion',
            'cron.vencimiento',
            'cron.corte',
            'respaldos',
            'host.cpu',
            'host.memoria',
            'host.disco',
        ]) {
            assert.include(ids, id)
        }
        const pg = componente(cuerpo, 'postgres')
        assert.isNumber(pg.latencia_ms)
        assert.isAbove(Number(pg.metricas.conexiones_max), 0)
        assert.isNumber(componente(cuerpo, 'host.memoria').metricas.total_bytes)
        for (const c of cuerpo.componentes) {
            assert.include(['ok', 'degradado', 'caido', 'desconocido'], c.estado)
            assert.isString(c.detalle)
            assert.notMatch(c.detalle, /postgres(ql)?:\/\/|redis:\/\/|password/i)
        }
    })

    test('Redis caído (simulado): redis caido, colas desconocido, estado general caido y < 2 s', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const colgada = { getJobCounts: nunca, getFailed: nunca }
        fijarFuentesSalud({
            ping: nunca,
            colas: () => new Map([['notify-envios', colgada], ['billing-cron', colgada]]),
        })
        const inicio = Date.now()
        const r = await estado(client.get('/api/v1/sistema/salud').bearerToken(token), 200)
        const ms = Date.now() - inicio
        assert.isBelow(ms, 2000)
        const cuerpo = r.body() as { estado_general: string; componentes: Componente[] }
        const redis = componente(cuerpo, 'redis')
        assert.equal(redis.estado, 'caido')
        assert.include(redis.detalle, 'No respondió')
        assert.isAtLeast(redis.latencia_ms ?? 0, TIMEOUT_CHEQUEO_MS - 50)
        assert.equal(componente(cuerpo, 'cola.notify-envios').estado, 'desconocido')
        assert.equal(componente(cuerpo, 'postgres').estado, 'ok')
        assert.equal(cuerpo.estado_general, 'caido')
    })

    test('aaa usa el vigía: un nodo caído de dos = degradado con desde', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = `salud-a-${Date.now()}`
        const b = `salud-b-${Date.now()}`
        const desde = new Date(Date.now() - 60_000).toISOString()
        await db.table('audit.outbox').multiInsert([
            { evento: 'aaa.caido', payload: JSON.stringify({ nodo: b, desde, ultimo_error: 'timeout' }) },
            { evento: 'aaa.recuperado', payload: JSON.stringify({ nodo: a, hasta: desde }) },
        ])
        const r = await estado(client.get('/api/v1/sistema/salud').bearerToken(token), 200)
        const aaa = componente(r.body(), 'aaa')
        assert.include(['degradado', 'caido'], aaa.estado)
        assert.include(String(aaa.metricas.caidos), b)
        assert.isNotNull(aaa.desde)
        // se recupera: ya no figura como caído
        await db.table('audit.outbox').insert({
            evento: 'aaa.recuperado',
            payload: JSON.stringify({ nodo: b, hasta: new Date().toISOString() }),
        })
        const despues = componente(
            (await estado(client.get('/api/v1/sistema/salud').bearerToken(token), 200)).body(),
            'aaa',
        )
        assert.notInclude(String(despues.metricas.caidos ?? ''), b)
    })

    test('disco: ≥ 80 % usado degradado, ≥ 95 % caído', async ({ client, assert }) => {
        assert.equal(estadoDisco(100, 21), 'ok')
        assert.equal(estadoDisco(100, 20), 'degradado')
        assert.equal(estadoDisco(100, 6), 'degradado')
        assert.equal(estadoDisco(100, 5), 'caido')
        const { token } = await usuarioConRoles(['admin'])
        fijarEspacioVolumen(async () => ({ total: 1000, libre: 30 }))
        const r = await estado(client.get('/api/v1/sistema/salud').bearerToken(token), 200)
        const disco = componente(r.body(), 'host.disco')
        assert.equal(disco.estado, 'caido')
        assert.equal(disco.metricas.porcentaje_usado, 97)
        assert.equal(r.body().estado_general, 'degradado')
    })

    test('estadoGeneral: desconocido no baja el estado; núcleo caído = caido', ({ assert }) => {
        const c = (id: string, e: Componente['estado']) =>
            ({ id, estado: e }) as Componente
        assert.equal(estadoGeneral([c('api', 'ok'), c('respaldos', 'desconocido')]), 'ok')
        assert.equal(estadoGeneral([c('api', 'ok'), c('coa', 'degradado')]), 'degradado')
        assert.equal(estadoGeneral([c('postgres', 'caido'), c('coa', 'ok')]), 'caido')
        assert.equal(estadoGeneral([c('api', 'ok'), c('routers', 'caido')]), 'degradado')
    })

    test('permisos: 401 sin sesión, 403 sin sistema.ver_salud', async ({ client }) => {
        await estado(client.get('/api/v1/sistema/salud'), 401)
        const { token } = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/sistema/salud').bearerToken(token), 403)
        const lectura = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/sistema/salud').bearerToken(lectura.token), 403)
    })
})
