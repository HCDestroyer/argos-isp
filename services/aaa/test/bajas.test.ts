import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { aplicarBaja } from '../src/bajas.ts'
import { cifrar } from '../src/cifrado.ts'
import { ConsumidorClientes } from '../src/clientes/consumidor.ts'
import { escribirClientes, leerRouters } from '../src/clientes/generar.ts'
import { ResolutorServicios, type FuenteRespaldo } from '../src/fuentes.ts'
import { parsearRegistro } from '../src/servicio.ts'
import { UltimoConocido } from '../src/ultimo_conocido.ts'
import { borrarPrefijo, CLAVE, prefijoDePrueba, redisDePrueba, servicio } from './ayudas.ts'

/**
 * Bajas definitivas (`contratos/eliminar.md`): `servicio.eliminado` y `router.eliminado` invalidan
 * la autorización en caché de cada nodo `aaa` (Redis y último perfil conocido) por evento, y
 * `router.eliminado` además saca el cliente RADIUS de `clients.d` y recarga FreeRADIUS.
 * Redis y Postgres reales; consumidor idempotente (cada evento se entrega dos veces).
 */

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function hasta<T>(fn: () => Promise<T | null | false>, ms = 10_000): Promise<T> {
    const limite = Date.now() + ms
    for (;;) {
        const v = await fn()
        if (v) return v
        if (Date.now() > limite) throw new Error('tiempo agotado')
        await esperar(100)
    }
}

const silencio = { info: () => {}, warn: () => {}, error: () => {} }

/** Respaldo que no responde: obliga al modo degradado (último perfil conocido). */
const respaldoCaido: FuenteRespaldo = {
    nombre: 'api',
    obtener: async () => {
        throw new Error('API caída')
    },
}

describe('aplicarBaja (Redis real)', () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()

    after(async () => {
        await borrarPrefijo(redis, prefijo)
        redis.disconnect()
    })

    it('servicio: el registro completo pasa a lápida (version + 1), los demás no se tocan y repetir no cambia nada', async () => {
        const borrado = servicio({ user_ppp: 'baja-1', servicio_id: 501, router_id: 9, version: 4 })
        const otro = servicio({ user_ppp: 'baja-2', servicio_id: 502, router_id: 9 })
        await redis.set(`${prefijo}baja-1`, JSON.stringify(borrado))
        await redis.set(`${prefijo}baja-2`, JSON.stringify(otro))
        const ultimo = new UltimoConocido()
        ultimo.guardar(borrado)
        ultimo.guardar(otro)

        const r = await aplicarBaja({ redis, prefijo, ultimoConocido: ultimo, lote: 1 }, { servicioId: 501 })
        assert.deepEqual(r, { lapidas: ['baja-1'], olvidados: 1 })
        assert.deepEqual(JSON.parse((await redis.get(`${prefijo}baja-1`))!), {
            eliminado: true,
            user_ppp: 'baja-1',
            servicio_id: 501,
            version: 5,
        })
        assert.deepEqual(JSON.parse((await redis.get(`${prefijo}baja-2`))!), otro)
        assert.equal(ultimo.obtener('baja-1'), null)
        assert.ok(ultimo.obtener('baja-2'))

        // Segunda entrega del evento: ya es lápida y no queda nada en memoria.
        assert.deepEqual(await aplicarBaja({ redis, prefijo, ultimoConocido: ultimo }, { servicioId: 501 }), {
            lapidas: [],
            olvidados: 0,
        })
    })

    it('servicio: la lápida que ya escribió A1 se respeta tal cual', async () => {
        const lapidaA1 = JSON.stringify({ eliminado: true, user_ppp: 'baja-3', servicio_id: 503, version: 8 })
        await redis.set(`${prefijo}baja-3`, lapidaA1)
        assert.deepEqual((await aplicarBaja({ redis, prefijo }, { servicioId: 503 })).lapidas, [])
        assert.equal(await redis.get(`${prefijo}baja-3`), lapidaA1)
    })

    it('router: toda clave con ese router_id queda como lápida; las de otro router siguen', async () => {
        const a = servicio({ user_ppp: 'rbaja-1', servicio_id: 601, router_id: 77 })
        const b = servicio({ user_ppp: 'rbaja-2', servicio_id: 602, router_id: 77, estado: 'suspendido' })
        const c = servicio({ user_ppp: 'rbaja-3', servicio_id: 603, router_id: 78 })
        for (const s of [a, b, c]) await redis.set(`${prefijo}${s.user_ppp}`, JSON.stringify(s))
        const ultimo = new UltimoConocido()
        for (const s of [a, b, c]) ultimo.guardar(s)

        const r = await aplicarBaja({ redis, prefijo, ultimoConocido: ultimo }, { routerId: 77 })
        assert.deepEqual(r.lapidas.sort(), ['rbaja-1', 'rbaja-2'])
        assert.equal(r.olvidados, 2)
        for (const u of ['rbaja-1', 'rbaja-2']) {
            assert.equal(JSON.parse((await redis.get(`${prefijo}${u}`))!).eliminado, true)
        }
        assert.deepEqual(JSON.parse((await redis.get(`${prefijo}rbaja-3`))!), c)
        assert.ok(ultimo.obtener('rbaja-3'))
    })

    it('después de la baja, la autorización rechaza aunque Redis y la API estén caídos (modo degradado)', async () => {
        const s = servicio({ user_ppp: 'baja-deg', servicio_id: 701 })
        const ultimo = new UltimoConocido()
        ultimo.guardar(s)
        const resolutor = new ResolutorServicios({
            redis,
            prefijo: `${prefijo}vacio:`,
            respaldo: respaldoCaido,
            log: silencio,
            ultimoConocido: ultimo,
        })
        // Antes: el último perfil conocido lo acepta.
        assert.equal((await resolutor.resolver('baja-deg')).origen, 'degradado')
        await aplicarBaja({ redis, prefijo, ultimoConocido: ultimo }, { servicioId: 701 })
        await assert.rejects(resolutor.resolver('baja-deg'), { motivo: 'sin_perfil' })
    })
})

describe('servicio.eliminado y router.eliminado por evento (Redis + Postgres reales)', () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()
    const pool = new pg.Pool({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER ?? 'argosisp',
        password: process.env.DB_PASSWORD ?? 'argosisp',
        database: process.env.AAA_PRUEBAS_DB ?? 'argosisp_test_a2',
        max: 2,
        connectionTimeoutMillis: 2000,
    })
    const stream = `prueba-a2-bajas-${randomBytes(4).toString('hex')}`
    const n = (parseInt(randomBytes(1).toString('hex'), 16) % 200) + 20
    const NAS = `198.51.102.${n}`
    let motivo: string | null = null
    let dir = ''
    let routerId = 0
    let consumidor: ConsumidorClientes
    const ultimo = new UltimoConocido()
    const recargas: string[] = []

    before(async () => {
        try {
            const { rows } = await pool.query<{ t: string | null }>(
                "SELECT to_regclass('network.routers') AS t",
            )
            if (!rows[0]?.t) motivo = 'network.routers no existe (migra la base de pruebas de A2)'
        } catch (e) {
            motivo = `sin Postgres de pruebas: ${(e as Error).message}`
        }
        if (motivo) return
        dir = await mkdtemp(join(tmpdir(), 'a2-bajas-'))
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO network.routers (nombre, host, nas_ip, radius_secret, modo_seguridad, activo)
             VALUES ($1, 'router.example', $2, $3, 'radius', true) RETURNING id`,
            [`a2-baja-${stream}`, NAS, cifrar('secreto-de-baja-1', CLAVE)],
        )
        routerId = Number(rows[0]?.id)
        consumidor = new ConsumidorClientes({
            redis,
            stream,
            grupo: 'radius-clientes:prueba',
            consumidor: 'prueba',
            bloqueoMs: 200,
            // Solo el router de la prueba (la base la comparten otras suites de A2). Después de
            // borrarlo `leerRouters` ya no lo trae, así que el filtro deja la lista vacía.
            regenerar: async () =>
                escribirClientes({
                    routers: (await leerRouters(pool)).filter((r) => r.id === routerId),
                    clave: CLAVE,
                    dir,
                }),
            recargar: async (m) => {
                recargas.push(m)
                return 'sin_lector'
            },
            bajas: (criterio) => aplicarBaja({ redis, prefijo, ultimoConocido: ultimo }, criterio),
            log: silencio,
        })
    })

    after(async () => {
        await consumidor?.detener()
        if (routerId) await pool.query('DELETE FROM network.routers WHERE id = $1', [routerId])
        await redis.del(stream)
        await borrarPrefijo(redis, prefijo)
        redis.disconnect()
        await pool.end()
        if (dir) await rm(dir, { recursive: true, force: true })
    })

    const archivo = () => readFile(join(dir, `router-${routerId}.conf`), 'utf8').catch(() => null)
    const publicar = (evento: string, payload: Record<string, unknown>) =>
        redis.xadd(stream, '*', 'id', String(Date.now()), 'evento', evento, 'payload', JSON.stringify(payload))
    const leidos = async () => {
        const info = (await redis.xinfo('GROUPS', stream)) as unknown[][]
        const g = info[0] as unknown[]
        return Number(g[g.indexOf('entries-read') + 1])
    }
    const sinPendientes = async () =>
        ((await redis.xpending(stream, 'radius-clientes:prueba')) as [number])[0] === 0

    it('arranca y escribe el cliente del router', async (t) => {
        if (motivo) return t.skip(motivo)
        await consumidor.iniciar()
        assert.match(await hasta(archivo), new RegExp(`ipaddr = ${NAS.replaceAll('.', '\\.')}$`, 'm'))
    })

    it('servicio.eliminado (dos veces): la clave queda como lápida y fuera del último perfil conocido', async (t) => {
        if (motivo) return t.skip(motivo)
        const s = servicio({ user_ppp: 'ev-baja-1', servicio_id: 9101, router_id: routerId, version: 2 })
        // A1 no alcanzó a escribir su lápida (Redis falló tras el COMMIT): sigue el registro completo.
        await redis.set(`${prefijo}ev-baja-1`, JSON.stringify(s))
        ultimo.guardar(s)
        const antes = recargas.length
        const payload = { servicio_id: 9101, empresa_id: 1, cliente_id: 1, router_id: routerId }
        await publicar('servicio.eliminado', payload)
        await publicar('servicio.eliminado', payload)
        await hasta(async () => (await leidos()) >= 2 && (await sinPendientes()))
        const valor = parsearRegistro(JSON.parse((await redis.get(`${prefijo}ev-baja-1`))!))
        assert.deepEqual(valor, { eliminado: true, user_ppp: 'ev-baja-1' })
        assert.equal(JSON.parse((await redis.get(`${prefijo}ev-baja-1`))!).version, 3)
        assert.equal(ultimo.obtener('ev-baja-1'), null)
        // Un servicio no toca los clientes RADIUS.
        assert.equal(recargas.length, antes)
        assert.ok(await archivo())
    })

    it('router.eliminado (dos veces): su cliente sale de clients.d, FreeRADIUS se recarga una vez y sus claves quedan como lápida', async (t) => {
        if (motivo) return t.skip(motivo)
        const huerfano = servicio({ user_ppp: 'ev-baja-r', servicio_id: 9102, router_id: routerId })
        await redis.set(`${prefijo}ev-baja-r`, JSON.stringify(huerfano))
        ultimo.guardar(huerfano)
        // Lo que hace A1 (`EliminarRouter`): borra la fila y emite el evento en la misma transacción.
        await pool.query('DELETE FROM network.routers WHERE id = $1', [routerId])
        const antes = recargas.length
        await publicar('router.eliminado', { router_id: routerId, empresa_id: null })
        await publicar('router.eliminado', { router_id: routerId, empresa_id: null })
        await hasta(async () => (await archivo()) === null)
        await hasta(async () => (await leidos()) >= 4 && (await sinPendientes()))
        assert.deepEqual(recargas.slice(antes), ['router.eliminado'])
        assert.equal(JSON.parse((await redis.get(`${prefijo}ev-baja-r`))!).eliminado, true)
        assert.equal(ultimo.obtener('ev-baja-r'), null)
    })

    it('un payload sin id se confirma sin efecto (no bloquea el grupo)', async (t) => {
        if (motivo) return t.skip(motivo)
        await publicar('servicio.eliminado', { empresa_id: 1 })
        await hasta(async () => (await leidos()) >= 5 && (await sinPendientes()))
    })
})
