import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { ErrorFuente, FuenteApi, MAXIMO_POR_LOTE, ResolutorServicios } from '../src/fuentes.ts'
import type { RegistroAaa, ServicioAaa } from '../src/servicio.ts'
import { ApiFalsa, borrarPrefijo, prefijoDePrueba, redisDePrueba, servicio } from './ayudas.ts'

/**
 * Consultas a la API por lotes (`POST /internal/aaa/servicios`): una reconexión masiva con Redis vacío
 * hace pocas consultas en vez de una por usuario, sin cambiar lo que recibe cada autorización.
 */
/** `servicio_id` de un registro que no es lápida (null si no hay registro). */
const id = (r: RegistroAaa | null | undefined): number | null => (r ? (r as ServicioAaa).servicio_id : null)

describe('FuenteApi por lotes', () => {
    const api = new ApiFalsa()
    let fuente: FuenteApi

    before(async () => {
        await api.iniciar()
    })

    beforeEach(() => {
        api.respuestas.clear()
        api.llamadas.length = 0
        api.respuestaLote = null
        fuente?.cerrar()
        fuente = new FuenteApi({ url: `${api.url}/api/v1/`, token: 't', timeoutMs: 1000 })
    })

    after(async () => {
        fuente.cerrar()
        await api.cerrar()
    })

    function registrar(n: number): string[] {
        return Array.from({ length: n }, (_, i) => {
            const user = `lote-${i}`
            api.respuestas.set(user, {
                status: 200,
                cuerpo: servicio({ user_ppp: user, servicio_id: i + 1 }),
            })
            return user
        })
    }

    it('una consulta sola sigue por GET, con su request_id', async () => {
        registrar(1)
        const r = await fuente.obtener('lote-0', { requestId: 'rad-uno' })
        assert.equal(id(r), 1)
        assert.deepEqual(
            api.llamadas.map((l) => [l.metodo, l.url, l.requestId]),
            [['GET', '/api/v1/internal/aaa/servicio?user_ppp=lote-0', 'rad-uno']],
        )
    })

    it('las del mismo instante van en un POST; cada una recibe su registro y los ausentes null', async () => {
        const usuarios = registrar(30)
        const pedidos = [...usuarios, 'no-existe']
        const resultados = await Promise.all(
            pedidos.map((u, i) => fuente.obtener(u, { requestId: `rad-${i}` })),
        )
        assert.deepEqual(
            resultados.map((r) => id(r)),
            [...usuarios.map((_, i) => i + 1), null],
        )
        assert.equal(api.llamadas.length, 1)
        const [lote] = api.llamadas
        assert.equal(lote?.metodo, 'POST')
        assert.equal(lote?.url, '/api/v1/internal/aaa/servicios')
        assert.equal(lote?.auth, 'Bearer t')
        assert.equal(lote?.requestId, 'rad-0', 'el lote lleva el request_id del primero')
        assert.deepEqual(lote?.usuarios, pedidos)
    })

    it(`parte en lotes de ${MAXIMO_POR_LOTE} y no repite usuarios`, async () => {
        const usuarios = registrar(250)
        const resultados = await Promise.all([...usuarios, 'lote-0'].map((u) => fuente.obtener(u)))
        assert.equal(resultados.filter((r) => r !== null).length, 251)
        const lotes = api.llamadas.map((l) => l.usuarios?.length)
        assert.deepEqual(lotes, [100, 100, 50], 'lote-0 repetido viaja una vez en su lote')
    })

    it('API sin la ruta de lotes (404): vuelve al GET y no lo intenta más', async () => {
        const usuarios = registrar(5)
        api.respuestaLote = { status: 404, cuerpo: { title: 'Not Found' } }
        const primeros = await Promise.all(usuarios.map((u) => fuente.obtener(u)))
        assert.deepEqual(
            primeros.map((r) => r?.user_ppp),
            usuarios,
        )
        assert.equal(fuente.usaLotes, false)
        assert.deepEqual(
            api.llamadas.map((l) => l.metodo),
            ['POST', 'GET', 'GET', 'GET', 'GET', 'GET'],
        )
        api.llamadas.length = 0
        await Promise.all(usuarios.map((u) => fuente.obtener(u)))
        assert.ok(api.llamadas.every((l) => l.metodo === 'GET'))
    })

    it('un 5xx del lote es error para todos (modo degradado en el resolutor)', async () => {
        const usuarios = registrar(3)
        api.respuestaLote = { status: 503 }
        const resultados = await Promise.allSettled(usuarios.map((u) => fuente.obtener(u)))
        for (const r of resultados) {
            assert.equal(r.status, 'rejected')
            assert.ok((r as PromiseRejectedResult).reason instanceof ErrorFuente)
        }
        assert.equal(fuente.usaLotes, true, 'un 5xx no apaga los lotes')
    })

    it('un registro fuera de contrato falla solo para su usuario', async () => {
        const usuarios = registrar(3)
        api.respuestas.set('lote-1', { status: 200, cuerpo: { user_ppp: 'lote-1', estado: 'otro' } })
        const resultados = await Promise.allSettled(usuarios.map((u) => fuente.obtener(u)))
        assert.deepEqual(
            resultados.map((r) => r.status),
            ['fulfilled', 'rejected', 'fulfilled'],
        )
    })

    it('lotes: false (AAA_API_LOTES=0) consulta de uno en uno', async () => {
        fuente.cerrar()
        fuente = new FuenteApi({ url: `${api.url}/api/v1/`, token: 't', timeoutMs: 1000, lotes: false })
        const usuarios = registrar(4)
        await Promise.all(usuarios.map((u) => fuente.obtener(u)))
        assert.deepEqual(
            api.llamadas.map((l) => l.metodo),
            ['GET', 'GET', 'GET', 'GET'],
        )
    })

    it('API colgada: el lote respeta el timeout', async () => {
        fuente.cerrar()
        fuente = new FuenteApi({ url: `${api.url}/api/v1/`, token: 't', timeoutMs: 150 })
        registrar(2)
        api.colgada = true
        try {
            const inicio = Date.now()
            const resultados = await Promise.allSettled(['lote-0', 'lote-1'].map((u) => fuente.obtener(u)))
            assert.ok(resultados.every((r) => r.status === 'rejected'))
            assert.ok(Date.now() - inicio < 1000)
        } finally {
            api.colgada = false
        }
    })
})

describe('ResolutorServicios con lotes y Redis real', () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()
    const api = new ApiFalsa()
    let fuente: FuenteApi

    before(async () => {
        await api.iniciar()
        fuente = new FuenteApi({ url: `${api.url}/api/v1/`, token: 't', timeoutMs: 1000 })
    })

    after(async () => {
        await borrarPrefijo(redis, prefijo)
        fuente.cerrar()
        await api.cerrar()
        redis.disconnect()
    })

    it('reconexión masiva con Redis vacío: un POST por cada 100 y todos quedan cacheados sin TTL', async () => {
        const resolutor = new ResolutorServicios({
            redis,
            prefijo,
            respaldo: fuente,
            log: { warn: () => {} },
        })
        const usuarios = Array.from({ length: 150 }, (_, i) => `masiva-${i}`)
        for (const [i, u] of usuarios.entries()) {
            api.respuestas.set(u, { status: 200, cuerpo: servicio({ user_ppp: u, servicio_id: 1000 + i }) })
        }
        const resueltos = await Promise.all(usuarios.map((u) => resolutor.resolver(u)))
        assert.ok(resueltos.every((r, i) => r.origen === 'api' && id(r.registro) === 1000 + i))
        assert.ok(
            api.llamadas.length <= 3,
            `pocas consultas a la API: ${api.llamadas.map((l) => `${l.metodo}×${l.usuarios?.length ?? 1}`).join(', ')}`,
        )
        assert.equal(api.llamadas.filter((l) => l.metodo === 'POST').length >= 1, true)
        const claves = await redis.keys(`${prefijo}*`)
        assert.equal(claves.length, 150)
        assert.equal(await redis.ttl(claves[0]!), -1, 'sin TTL (regla 5)')

        api.llamadas.length = 0
        const otraVez = await Promise.all(usuarios.map((u) => resolutor.resolver(u)))
        assert.ok(otraVez.every((r) => r.origen === 'redis'))
        assert.equal(api.llamadas.length, 0)
    })
})
