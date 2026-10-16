import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { cifrar } from '../src/cifrado.ts'
import {
    ClienteRouterOS,
    clienteDeRouter,
    diferencias,
    normalizarValor,
    RouterOSCredenciales,
    RouterOSInalcanzable,
    RouterOSSolicitud,
    RouterSinCredenciales,
    RUTAS,
    type FilaRouterOS,
} from '../src/routeros/index.ts'
import { RouterOSFalso } from '../src/routeros/falso.ts'
import { CLAVE } from './ayudas.ts'

const COMMENT = 'argosisp:servicio:7'

function bitacora() {
    const filas: FilaRouterOS[] = []
    return { filas, registrar: async (f: FilaRouterOS) => void filas.push(f) }
}

function cliente(
    falso: RouterOSFalso,
    b = bitacora(),
    extra: Partial<{ timeoutMs: number; password: string }> = {},
) {
    return new ClienteRouterOS(
        {
            routerId: 3,
            url: falso.url,
            usuario: falso.usuario,
            password: extra.password ?? falso.password,
            timeoutMs: extra.timeoutMs ?? 1000,
            reintentos: 3,
            esperaMs: 5,
        },
        { bitacora: b },
    )
}

describe('normalización de propiedades', () => {
    it('velocidades, booleanos, MAC y duraciones en la forma de RouterOS', () => {
        assert.equal(normalizarValor('5120k/20480k'), '5120000/20480000')
        assert.equal(
            normalizarValor('5M/20M 10M/40M 4M/16M 16/16 8 1M/4M'),
            normalizarValor('5000000/20000000 10000000/40000000 4000000/16000000 16s/16s 8 1000000/4000000'),
        )
        assert.equal(normalizarValor('yes'), 'true')
        assert.equal(normalizarValor('aa:bb:cc:dd:ee:ff'), normalizarValor('AA:BB:CC:DD:EE:FF'))
        assert.deepEqual(
            diferencias(
                { 'max-limit': '1M/2M', target: '10.0.0.1/32' },
                {
                    'max-limit': '1000000/2000000',
                    target: '10.0.0.2/32',
                },
            ),
            { target: '10.0.0.1/32' },
        )
    })
})

describe('cliente REST de RouterOS contra el RouterOS falso', () => {
    let falso: RouterOSFalso

    beforeEach(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
    })
    afterEach(async () => {
        await falso.cerrar()
    })

    it('asegurar crea, no reescribe lo que ya está y corrige solo lo que difiere', async () => {
        const b = bitacora()
        const c = cliente(falso, b)
        const props = { name: 'svc-7', target: '10.10.1.7/32', 'max-limit': '5120k/20480k' }

        const r1 = await c.asegurar('/queue/simple', COMMENT, props, { servicio_id: 7, evento_id: 'e1' })
        assert.equal(r1.accion, 'creado')
        assert.equal(r1.objeto['max-limit'], '5120000/20480000')
        assert.equal(falso.conComment('/queue/simple', COMMENT).length, 1)

        const r2 = await c.asegurar('/queue/simple', COMMENT, props, { servicio_id: 7 })
        assert.equal(r2.accion, 'sin_cambios')

        const r3 = await c.asegurar('/queue/simple', COMMENT, { ...props, 'max-limit': '1024k/2048k' })
        assert.equal(r3.accion, 'actualizado')
        const patch = falso.escrituras.at(-1)!
        assert.equal(patch.metodo, 'PATCH')
        assert.deepEqual(patch.cuerpo, { 'max-limit': '1024k/2048k' })

        // audit.red: una fila por escritura (PUT y PATCH), ninguna por lectura
        assert.equal(b.filas.length, 2)
        assert.equal(b.filas[0]!.tipo, 'routeros')
        assert.equal(b.filas[0]!.router_id, 3)
        assert.equal(b.filas[0]!.servicio_id, 7)
        assert.equal(b.filas[0]!.comando.metodo, 'PUT')
        assert.equal(b.filas[0]!.comando.evento_id, 'e1')
        assert.equal(b.filas[0]!.ok, true)
        assert.equal((b.filas[0]!.respuesta.objeto as Record<string, string>)['.id'], r1.objeto['.id'])
        assert.deepEqual(b.filas[1]!.comando.antes, { 'max-limit': '5120000/20480000' })
        assert.ok(!JSON.stringify(b.filas).includes(falso.password), 'la contraseña nunca va a audit.red')
    })

    it('asegurar borra duplicados con el mismo comment', async () => {
        const c = cliente(falso)
        falso
            .tabla('/ip/firewall/address-list')
            .push(
                { '.id': '*A1', list: 'suspendidos', address: '10.10.1.7', comment: COMMENT },
                { '.id': '*A2', list: 'suspendidos', address: '10.10.1.8', comment: COMMENT },
            )
        const r = await c.asegurar('/ip/firewall/address-list', COMMENT, {
            list: 'suspendidos',
            address: '10.10.1.7',
        })
        assert.equal(r.accion, 'sin_cambios')
        assert.equal(r.duplicados, 1)
        assert.deepEqual(
            falso.conComment('/ip/firewall/address-list', COMMENT).map((o) => o['.id']),
            ['*A1'],
        )
    })

    it('borrar elimina todo lo del comment y no escribe si no hay nada', async () => {
        const b = bitacora()
        const c = cliente(falso, b)
        await c.asegurar('/ip/arp', COMMENT, {
            address: '10.10.1.7',
            'mac-address': 'aa:bb:cc:00:00:07',
            interface: 'ether2',
        })
        assert.equal(await c.borrar('/ip/arp', COMMENT), 1)
        assert.equal(await c.borrar('/ip/arp', COMMENT), 0)
        assert.equal(falso.tabla('/ip/arp').length, 0)
        assert.deepEqual(
            b.filas.map((f) => f.comando.metodo),
            ['PUT', 'DELETE'],
        )
    })

    it('opera los ocho menús administrados', async () => {
        const c = cliente(falso)
        const props: Record<(typeof RUTAS)[number], Record<string, string>> = {
            '/queue/simple': { target: '10.0.0.1/32', 'max-limit': '1M/2M' },
            '/queue/tree': { name: 'argosisp-plan-1-bajada', parent: 'global', 'max-limit': '20M' },
            '/queue/type': {
                name: 'argosisp-plan-1-bajada',
                kind: 'pcq',
                'pcq-rate': '20M',
                'pcq-classifier': 'dst-address',
            },
            '/ip/firewall/address-list': { list: 'argosisp-plan-1', address: '10.0.0.1' },
            '/ip/firewall/mangle': {
                chain: 'forward',
                action: 'mark-packet',
                'new-packet-mark': 'p1',
                passthrough: 'no',
            },
            '/ip/dhcp-server/lease': {
                address: '10.0.0.1',
                'mac-address': 'aa:bb:cc:dd:ee:01',
                server: 'dhcp1',
            },
            '/ip/arp': { address: '10.0.0.1', 'mac-address': 'aa:bb:cc:dd:ee:01', interface: 'ether2' },
            '/ppp/profile': { name: 'plan-1', 'parent-queue': 'argosisp:plan:1' },
        }
        for (const ruta of RUTAS) {
            const comment = `argosisp:prueba:${ruta}`
            assert.equal((await c.asegurar(ruta, comment, props[ruta])).accion, 'creado', ruta)
            assert.equal((await c.asegurar(ruta, comment, props[ruta])).accion, 'sin_cambios', ruta)
            assert.equal((await c.buscar(ruta, comment)).length, 1, ruta)
            assert.equal(await c.borrar(ruta, comment), 1, ruta)
        }
        await assert.rejects(() => c.listar('/system/script' as never), /no administrada/)
    })

    it('credenciales inválidas: error tipado y sin reintentos', async () => {
        const c = cliente(falso, bitacora(), { password: 'otra' })
        await assert.rejects(
            () => c.buscar('/queue/simple', COMMENT),
            (e) => {
                assert.ok(e instanceof RouterOSCredenciales)
                assert.equal(e.tipo, 'credenciales')
                assert.equal(e.status, 401)
                return true
            },
        )
        assert.equal(falso.peticiones.length, 1)
    })

    it('400 de RouterOS con su mensaje, sin reintentos y auditado como fallo', async () => {
        const b = bitacora()
        const c = cliente(falso, b)
        await c.crear('/ip/firewall/address-list', { list: 'suspendidos', address: '10.0.0.9' })
        await assert.rejects(
            () => c.crear('/ip/firewall/address-list', { list: 'suspendidos', address: '10.0.0.9' }),
            (e) => {
                assert.ok(e instanceof RouterOSSolicitud)
                assert.equal(e.status, 400)
                assert.equal(e.detalle, 'failure: already have such entry')
                return true
            },
        )
        assert.equal(b.filas.length, 2)
        assert.equal(b.filas[1]!.ok, false)
        assert.equal(b.filas[1]!.respuesta.detalle, 'failure: already have such entry')
        assert.equal(b.filas[1]!.respuesta.status, 400)
    })

    it('5xx transitorio: reintenta con backoff y termina bien', async () => {
        const c = cliente(falso)
        falso.fallar(2, 503)
        const r = await c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' })
        assert.equal(r.accion, 'creado')
        assert.equal(falso.tabla('/queue/simple').length, 1)
    })

    it('un PUT que llegó pero perdió la respuesta no deja duplicado al reintentar', async () => {
        const c = cliente(falso)
        falso.fallar(1, 500, { despues: true })
        await assert.rejects(() => c.crear('/queue/simple', { target: '10.0.0.7/32', comment: COMMENT }))
        assert.equal(falso.tabla('/queue/simple').length, 1, 'el router sí lo creó')
        const r = await c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' })
        assert.equal(r.accion, 'sin_cambios')
        assert.equal(falso.tabla('/queue/simple').length, 1)
    })

    it('router caído: inalcanzable tras 1 + 3 intentos; al volver funciona', async () => {
        const b = bitacora()
        const c = cliente(falso, b)
        await falso.caer()
        await assert.rejects(
            () => c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' }),
            (e) => {
                assert.ok(e instanceof RouterOSInalcanzable)
                assert.equal(e.codigo, 'ECONNREFUSED')
                assert.equal(e.reintentable, true)
                return true
            },
        )
        await falso.levantar()
        assert.equal((await c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' })).accion, 'creado')
    })

    it('timeout: inalcanzable con ETIMEDOUT', async () => {
        const c = new ClienteRouterOS({
            routerId: 3,
            url: falso.url,
            usuario: falso.usuario,
            password: falso.password,
            timeoutMs: 50,
            reintentos: 1,
            esperaMs: 1,
        })
        falso.retrasoMs = 200
        await assert.rejects(
            () => c.buscar('/queue/simple', COMMENT),
            (e) => {
                assert.ok(e instanceof RouterOSInalcanzable)
                assert.equal(e.codigo, 'ETIMEDOUT')
                return true
            },
        )
        falso.retrasoMs = 0
        c.cerrar()
    })
})

describe('credenciales del router (v1) y HTTPS', () => {
    let dir: string
    let cert: string
    let key: string
    let falso: RouterOSFalso

    before(async () => {
        dir = mkdtempSync(join(tmpdir(), 'a2-routeros-'))
        execFileSync(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-nodes',
                '-days',
                '1',
                '-subj',
                '/CN=127.0.0.1',
                '-addext',
                'subjectAltName=IP:127.0.0.1',
                '-keyout',
                join(dir, 'key.pem'),
                '-out',
                join(dir, 'cert.pem'),
            ],
            { stdio: 'ignore' },
        )
        cert = readFileSync(join(dir, 'cert.pem'), 'utf8')
        key = readFileSync(join(dir, 'key.pem'), 'utf8')
        falso = new RouterOSFalso({ tls: { cert, key } })
        await falso.levantar()
    })
    after(async () => {
        await falso.cerrar()
        rmSync(dir, { recursive: true, force: true })
    })

    const router = (extra: Record<string, unknown> = {}) => ({
        id: 9,
        host: 'ignorado',
        api_url: falso.url,
        api_usuario: falso.usuario,
        api_password: cifrar(falso.password, CLAVE),
        ...extra,
    })

    it('verifica el certificado por defecto: autofirmado sin CA → error TLS sin reintentos', async () => {
        const c = clienteDeRouter(router(), { clave: CLAVE, esperaMs: 1 })
        const antes = falso.peticiones.length
        await assert.rejects(
            () => c.probar(),
            (e) => {
                assert.ok(e instanceof RouterOSInalcanzable)
                assert.equal(e.reintentable, false)
                return true
            },
        )
        assert.equal(falso.peticiones.length, antes)
        c.cerrar()
    })

    it('con la CA del router o con la verificación apagada, conecta y descifra la contraseña v1', async () => {
        const conCa = clienteDeRouter(router({ api_ca: cert }), { clave: CLAVE })
        assert.equal((await conCa.probar())['board-name'], 'falso')
        const sinVerificar = clienteDeRouter(router({ api_tls_verificar: false }), { clave: CLAVE })
        assert.equal((await sinVerificar.buscar('/queue/simple', COMMENT)).length, 0)
        conCa.cerrar()
        sinVerificar.cerrar()
    })

    it('sin credenciales o con api_password ilegible: RouterSinCredenciales', () => {
        assert.throws(
            () => clienteDeRouter(router({ api_password: null }), { clave: CLAVE }),
            RouterSinCredenciales,
        )
        assert.throws(
            () => clienteDeRouter(router({ api_password: 'v1.x.y.z' }), { clave: CLAVE }),
            RouterSinCredenciales,
        )
    })
})
