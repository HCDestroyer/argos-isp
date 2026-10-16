import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { Redis } from 'ioredis'
import { crearApp } from '../src/app.ts'
import { FuenteApi, ResolutorServicios, type ModoDegradado } from '../src/fuentes.ts'
import { MetricasAaa } from '../src/metricas.ts'
import { UltimoConocido } from '../src/ultimo_conocido.ts'
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

/**
 * Semana 3, tarea 2: modo degradado. Si Redis y la API no responden, `aaa` acepta con el último perfil
 * conocido (mismo estado: un suspendido sigue suspendido, un retirado sigue rechazado) y, si no lo
 * tiene, rechaza (503 → fail → Reject). Redis real (base 2) y API simulada.
 */

/** Redis inalcanzable: cada comando falla de inmediato (sin cola offline), como en producción. */
function redisCaido(): Redis {
    const r = new Redis({
        host: '127.0.0.1',
        port: 1,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        lazyConnect: true,
    })
    r.on('error', () => {})
    return r
}

describe('UltimoConocido', () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()
    let dir = ''

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), 'aaa-degradado-'))
    })

    afterEach(async () => {
        await borrarPrefijo(redis, prefijo)
    })

    after(async () => {
        await rm(dir, { recursive: true, force: true })
        redis.disconnect()
    })

    it('guarda, reemplaza y al pasar de max expulsa el que lleva más tiempo sin verse', () => {
        const u = new UltimoConocido({ max: 2 })
        u.guardar(servicio({ user_ppp: 'a' }))
        u.guardar(servicio({ user_ppp: 'b' }))
        u.guardar(servicio({ user_ppp: 'a', estado: 'suspendido' }))
        u.guardar(servicio({ user_ppp: 'c' }))
        assert.equal(u.tamano, 2)
        assert.equal(u.obtener('b'), null, 'b era el más viejo')
        assert.equal((u.obtener('a')?.registro as { estado: string }).estado, 'suspendido')
        u.olvidar('a')
        assert.equal(u.obtener('a'), null)
    })

    it('espejo de aaa:user:*: agrega y reemplaza, cuenta inválidos y nunca borra', async () => {
        const u = new UltimoConocido()
        u.guardar(servicio({ user_ppp: 'solo-en-memoria' }))
        for (let i = 0; i < 1200; i++) {
            await redis.set(`${prefijo}e-${i}`, JSON.stringify(servicio({ user_ppp: `e-${i}`, servicio_id: i })))
        }
        await redis.set(`${prefijo}e-lapida`, JSON.stringify({ eliminado: true, user_ppp: 'e-lapida' }))
        await redis.set(`${prefijo}e-roto`, '{no es json')
        const r = await u.espejar(redis, prefijo, 300)
        assert.deepEqual(r, { leidos: 1201, invalidos: 1 })
        assert.equal(u.tamano, 1202)
        assert.ok(u.obtener('solo-en-memoria'), 'el espejo no borra lo que no está en Redis')
        assert.deepEqual(u.obtener('e-lapida')?.registro, { eliminado: true, user_ppp: 'e-lapida' })
        assert.ok(u.ultimoEspejo !== null)

        // Redis se vacía (reinicio sin datos): la copia sigue.
        await borrarPrefijo(redis, prefijo)
        await u.espejar(redis, prefijo)
        assert.equal(u.tamano, 1202)
    })

    it('espejo con Redis caído lanza y conserva lo que había', async () => {
        const u = new UltimoConocido()
        u.guardar(servicio({ user_ppp: 'x' }))
        const caido = redisCaido()
        await assert.rejects(u.espejar(caido, prefijo))
        assert.equal(u.tamano, 1)
        assert.equal(u.ultimoEspejo, null)
        caido.disconnect()
    })

    it('archivo: vuelca de forma atómica (0600, sin contraseñas en claro) y carga al arrancar', async () => {
        const ruta = join(dir, 'sub', 'ultimo-conocido.json')
        const u = new UltimoConocido({ ruta })
        assert.equal(await u.cargar(), 0, 'sin archivo no falla')
        u.guardar(servicio({ user_ppp: 'f-1' }, 'clave-super-secreta'), 1000)
        u.guardar({ eliminado: true, user_ppp: 'f-2' }, 2000)
        await u.volcar()
        const contenido = await readFile(ruta, 'utf8')
        assert.ok(!contenido.includes('clave-super-secreta'))
        assert.equal((await stat(ruta)).mode & 0o777, 0o600)

        const otro = new UltimoConocido({ ruta })
        otro.guardar(servicio({ user_ppp: 'f-1', estado: 'suspendido' }), 5000)
        assert.equal(await otro.cargar(), 1, 'lo visto en el proceso gana al archivo')
        assert.equal((otro.obtener('f-1')?.registro as { estado: string }).estado, 'suspendido')
        assert.equal(otro.obtener('f-2')?.vistoEn, 2000)
    })
})

describe('POST /aaa/authorize en modo degradado', () => {
    const redisVivo = redisDePrueba()
    const prefijo = prefijoDePrueba()
    const api = new ApiFalsa()
    const lineas: Record<string, unknown>[] = []
    let ultimoConocido: UltimoConocido
    let metricas: MetricasAaa
    let redisActual: Redis
    let caido: Redis

    before(async () => {
        await api.iniciar()
        caido = redisCaido()
    })

    beforeEach(() => {
        ultimoConocido = new UltimoConocido()
        metricas = new MetricasAaa()
        api.respuestas.clear()
        api.colgada = false
        lineas.length = 0
        redisActual = redisVivo
    })

    afterEach(async () => {
        // Si una prueba falla con la API colgada, que no deje sockets abiertos que cuelguen la corrida.
        api.colgada = false
        await borrarPrefijo(redisVivo, prefijo)
    })

    after(async () => {
        await api.cerrar()
        redisVivo.disconnect()
        caido.disconnect()
    })

    function crear(modoDegradado: ModoDegradado = 'aceptar', redis: Redis = redisActual) {
        return crearApp({
            resolutor: new ResolutorServicios({
                redis,
                prefijo,
                respaldo: new FuenteApi({ url: api.url, token: 't', timeoutMs: 150 }),
                log: { warn: () => {} },
                ultimoConocido,
                modoDegradado,
            }),
            claveSecretos: CLAVE,
            perfil: PERFIL,
            logLevel: 'info',
            logStream: { write: (l) => void lineas.push(JSON.parse(l) as Record<string, unknown>) },
            metricas,
            ultimoConocido,
            redisListo: () => redis.status === 'ready',
        })
    }

    async function autorizar(app: ReturnType<typeof crear>, usuario: string) {
        const inicio = performance.now()
        const res = await app.inject({
            method: 'POST',
            url: '/aaa/authorize',
            payload: cuerpoRest({ 'User-Name': usuario, 'NAS-IP-Address': '10.255.255.2' }),
        })
        return {
            status: res.statusCode,
            cuerpo: res.body ? (res.json() as Record<string, unknown>) : null,
            ms: performance.now() - inicio,
        }
    }

    it('Redis y API caídos: acepta con el último perfil conocido, igual que en normal, y lo dice en log y métricas', async () => {
        // 1. Login normal por la API: deja el perfil.
        api.respuestas.set('d-activo', { status: 200, cuerpo: servicio({ user_ppp: 'd-activo' }, 'k1') })
        const normal = crear('aceptar', caido)
        const antes = await autorizar(normal, 'd-activo')
        assert.equal(antes.status, 200)

        // 2. Se cae también la API (colgada: el peor caso, espera el timeout).
        api.colgada = true
        const durante = await autorizar(normal, 'd-activo')
        assert.equal(durante.status, 200)
        assert.deepEqual(durante.cuerpo, antes.cuerpo, 'mismos atributos que en modo normal')
        assert.ok(durante.ms < 800, `responde dentro del timeout de rlm_rest (${durante.ms} ms)`)
        // Dos autorizaciones degradadas: un solo "inicio".
        await autorizar(normal, 'd-activo')
        assert.equal(lineas.filter((l) => l.msg === 'modo degradado: inicio').length, 1)
        const linea = lineas.find((l) => l.msg === 'authorize: modo degradado, último perfil conocido')
        assert.equal(linea?.modo, 'degradado')
        assert.equal(linea?.usuario, 'd-activo')
        assert.equal(typeof linea?.perfil_edad_s, 'number')
        assert.match(String(linea?.error), /Redis: .*; api: /)
        assert.equal(lineas.findLast((l) => l.msg === 'authorize')?.origen, 'degradado')

        const salud = (await normal.inject({ method: 'GET', url: '/health' })).json()
        assert.equal(salud.modo, 'degradado')
        assert.equal(salud.ultimo_conocido, 1)
        const m = (await normal.inject({ method: 'GET', url: '/metrics' })).body
        assert.match(m, /^argosisp_aaa_degradado 1$/m)
        assert.match(m, /^argosisp_aaa_degradado_total\{resultado="perfil"\} 2$/m)
        assert.match(m, /^argosisp_aaa_ultimo_conocido_registros 1$/m)
        assert.match(m, /^argosisp_aaa_autorizaciones_total\{resultado="accept"\} 3$/m)

        // 3. Vuelve la API: modo normal y una línea de fin.
        api.colgada = false
        const despues = await autorizar(normal, 'd-activo')
        assert.equal(despues.status, 200)
        const fin = lineas.find((l) => l.msg === 'modo degradado: fin')
        assert.equal(fin?.atendidas, 2)
        assert.match((await normal.inject({ method: 'GET', url: '/metrics' })).body, /^argosisp_aaa_degradado 0$/m)
        await normal.close()
    })

    it('el estado no cambia en degradado: suspendido sigue con el perfil de corte, retirado y lápida se rechazan', async () => {
        ultimoConocido.guardar(servicio({ user_ppp: 'd-susp', estado: 'suspendido' }, 'k'))
        ultimoConocido.guardar(servicio({ user_ppp: 'd-ret', estado: 'retirado' }, 'k'))
        ultimoConocido.guardar({ eliminado: true, user_ppp: 'd-lapida' })
        api.respuestas.set('d-susp', { status: 500 })
        api.respuestas.set('d-ret', { status: 500 })
        api.respuestas.set('d-lapida', { status: 500 })
        const app = crear('aceptar', caido)
        const susp = await autorizar(app, 'd-susp')
        assert.equal(susp.status, 200)
        assert.equal(susp.cuerpo?.['reply:Mikrotik-Address-List'], 'suspendidos')
        assert.equal(susp.cuerpo?.['reply:Mikrotik-Rate-Limit'], '256k/256k')
        assert.equal((await autorizar(app, 'd-ret')).status, 401)
        assert.equal((await autorizar(app, 'd-lapida')).status, 404)
        await app.close()
    })

    it('sin último perfil conocido → 503 (Reject) y métrica sin_perfil', async () => {
        api.respuestas.set('d-nuevo', { status: 503 })
        const app = crear('aceptar', caido)
        const r = await autorizar(app, 'd-nuevo')
        assert.equal(r.status, 503)
        assert.match((await app.inject({ method: 'GET', url: '/metrics' })).body, /resultado="sin_perfil"\} 1$/m)
        assert.ok(lineas.some((l) => l.resultado === 'sin_perfil' && l.modo === 'degradado'))
        await app.close()
    })

    it('AAA_DEGRADADO=rechazar: 503 aunque haya perfil conocido (comportamiento anterior)', async () => {
        ultimoConocido.guardar(servicio({ user_ppp: 'd-rech' }, 'k'))
        api.respuestas.set('d-rech', { status: 500 })
        const app = crear('rechazar', caido)
        assert.equal((await autorizar(app, 'd-rech')).status, 503)
        assert.match((await app.inject({ method: 'GET', url: '/metrics' })).body, /resultado="desactivado"\} 1$/m)
        await app.close()
    })

    it('la API dijo 404: se olvida el perfil y en degradado ya no se acepta', async () => {
        ultimoConocido.guardar(servicio({ user_ppp: 'd-borrado' }, 'k'))
        const app = crear('aceptar', caido)
        assert.equal((await autorizar(app, 'd-borrado')).status, 404)
        api.respuestas.set('d-borrado', { status: 500 })
        assert.equal((await autorizar(app, 'd-borrado')).status, 503)
        await app.close()
    })

    it('Redis responde pero perdió la clave (reinicio sin datos) y la API no responde: sirve el espejo', async () => {
        await redisVivo.set(`${prefijo}d-espejo`, JSON.stringify(servicio({ user_ppp: 'd-espejo' }, 'k-espejo')))
        await ultimoConocido.espejar(redisVivo, prefijo)
        await redisVivo.del(`${prefijo}d-espejo`)
        api.respuestas.set('d-espejo', { status: 502 })
        const app = crear('aceptar', redisVivo)
        const r = await autorizar(app, 'd-espejo')
        assert.equal(r.status, 200)
        assert.equal(r.cuerpo?.['control:Cleartext-Password'], 'k-espejo')
        assert.equal(await redisVivo.exists(`${prefijo}d-espejo`), 0, 'el modo degradado no escribe en Redis')
        await app.close()
    })

    it('Redis con la clave y API caída: modo normal (Redis basta), sin degradado', async () => {
        await redisVivo.set(`${prefijo}d-redis`, JSON.stringify(servicio({ user_ppp: 'd-redis' }, 'k')))
        api.colgada = true
        const app = crear('aceptar', redisVivo)
        assert.equal((await autorizar(app, 'd-redis')).status, 200)
        assert.equal(metricas.enDegradado, false)
        assert.ok(ultimoConocido.obtener('d-redis'), 'lo visto en Redis queda como último perfil conocido')
        await app.close()
    })
})
