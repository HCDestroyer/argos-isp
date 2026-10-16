import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { cifrar } from '#shared/cifrado'
import { ClienteRouterOS, RUTAS, type FilaRouterOS, type RutaRouterOS } from '#network/routeros/cliente'
import {
    ErrorRouterOS,
    RouterOSCredenciales,
    RouterOSInalcanzable,
    RouterOSSolicitud,
} from '#network/routeros/errores'
import { diferencias, normalizarValor } from '#network/routeros/normalizar'
import { clienteDeRouter, RouterSinCredenciales } from '#network/routeros/router'
import { RouterOSFalso } from '#network/routeros/falso'

/**
 * Cliente REST de RouterOS 7 (semana 2, tarea 1) contra el RouterOS falso en memoria: idempotencia
 * por `comment`, normalización, errores tipados, reintentos, auditoría de escrituras y TLS.
 */

const COMMENT = 'argosisp:servicio:7'
const CLAVE = randomBytes(32)

function bitacora() {
    const filas: FilaRouterOS[] = []
    return { filas, registrar: async (f: FilaRouterOS) => void filas.push(f) }
}

function cliente(falso: RouterOSFalso, b = bitacora(), extra: Partial<{ password: string }> = {}) {
    return new ClienteRouterOS(
        {
            routerId: 3,
            url: falso.url,
            usuario: falso.usuario,
            password: extra.password ?? falso.password,
            timeoutMs: 1000,
            reintentos: 3,
            esperaMs: 5,
        },
        { bitacora: b },
    )
}

/** `accion` de un `asegurar` (sin acceder a un miembro de un `await`). */
const accion = (p: Promise<{ accion: string }>) => p.then((r) => r.accion)

async function capturar(fn: () => Promise<unknown>): Promise<ErrorRouterOS | Error> {
    try {
        await fn()
    } catch (error) {
        return error as Error
    }
    throw new Error('se esperaba un error')
}

test.group('RouterOS: normalización de propiedades', () => {
    test('velocidades, booleanos, MAC y duraciones en la forma de RouterOS', ({ assert }) => {
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
                { 'max-limit': '1000000/2000000', target: '10.0.0.2/32' },
            ),
            { target: '10.0.0.1/32' },
        )
    })
})

test.group('RouterOS: cliente REST contra el RouterOS falso', (group) => {
    let falso: RouterOSFalso

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        return () => falso.cerrar()
    })

    test('asegurar crea, no reescribe lo que ya está y corrige solo lo que difiere', async ({ assert }) => {
        const b = bitacora()
        const c = cliente(falso, b)
        const props = { name: 'svc-7', target: '10.10.1.7/32', 'max-limit': '5120k/20480k' }

        const r1 = await c.asegurar('/queue/simple', COMMENT, props, { servicio_id: 7, evento_id: 'e1' })
        assert.equal(r1.accion, 'creado')
        assert.equal(r1.objeto['max-limit'], '5120000/20480000')
        assert.lengthOf(falso.conComment('/queue/simple', COMMENT), 1)

        assert.equal(
            await accion(c.asegurar('/queue/simple', COMMENT, props, { servicio_id: 7 })),
            'sin_cambios',
        )

        const r3 = await c.asegurar('/queue/simple', COMMENT, { ...props, 'max-limit': '1024k/2048k' })
        assert.equal(r3.accion, 'actualizado')
        const patch = falso.escrituras.at(-1)!
        assert.equal(patch.metodo, 'PATCH')
        assert.deepEqual(patch.cuerpo, { 'max-limit': '1024k/2048k' })

        // audit.red: una fila por escritura (PUT y PATCH), ninguna por lectura
        assert.lengthOf(b.filas, 2)
        assert.equal(b.filas[0]!.tipo, 'routeros')
        assert.equal(b.filas[0]!.router_id, 3)
        assert.equal(b.filas[0]!.servicio_id, 7)
        assert.equal(b.filas[0]!.comando.metodo, 'PUT')
        assert.equal(b.filas[0]!.comando.evento_id, 'e1')
        assert.isTrue(b.filas[0]!.ok)
        assert.equal((b.filas[0]!.respuesta.objeto as Record<string, string>)['.id'], r1.objeto['.id'])
        assert.deepEqual(b.filas[1]!.comando.antes, { 'max-limit': '5120000/20480000' })
        assert.notInclude(JSON.stringify(b.filas), falso.password, 'la contraseña nunca va a audit.red')
    })

    test('asegurar borra duplicados con el mismo comment', async ({ assert }) => {
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

    test('borrar elimina todo lo del comment y no escribe si no hay nada', async ({ assert }) => {
        const b = bitacora()
        const c = cliente(falso, b)
        await c.asegurar('/ip/arp', COMMENT, {
            address: '10.10.1.7',
            'mac-address': 'aa:bb:cc:00:00:07',
            interface: 'ether2',
        })
        assert.equal(await c.borrar('/ip/arp', COMMENT), 1)
        assert.equal(await c.borrar('/ip/arp', COMMENT), 0)
        assert.lengthOf(falso.tabla('/ip/arp'), 0)
        assert.deepEqual(
            b.filas.map((f) => f.comando.metodo),
            ['PUT', 'DELETE'],
        )
    })

    test('opera los diez menús administrados', async ({ assert }) => {
        const c = cliente(falso)
        const props: Record<RutaRouterOS, Record<string, string>> = {
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
            '/ipv6/firewall/address-list': { list: 'argosisp-plan-1', address: '2001:db8:1::/56' },
            '/ipv6/firewall/mangle': {
                chain: 'forward',
                action: 'mark-packet',
                'new-packet-mark': 'p1',
                passthrough: 'no',
            },
            // `parent-queue` debe nombrar una cola simple que exista (el falso lo valida como RouterOS)
            '/ppp/profile': { name: 'plan-1', 'local-address': '10.0.0.1' },
        }
        for (const ruta of RUTAS) {
            const comment = `argosisp:prueba:${ruta}`
            assert.equal(await accion(c.asegurar(ruta, comment, props[ruta])), 'creado', ruta)
            assert.equal(await accion(c.asegurar(ruta, comment, props[ruta])), 'sin_cambios', ruta)
            assert.lengthOf(await c.buscar(ruta, comment), 1, ruta)
            assert.equal(await c.borrar(ruta, comment), 1, ruta)
        }
        const error = await capturar(() => c.listar('/system/script' as RutaRouterOS))
        assert.match(error.message, /no administrada/)
    })

    test('credenciales inválidas: error tipado y sin reintentos', async ({ assert }) => {
        const c = cliente(falso, bitacora(), { password: 'otra' })
        const error = await capturar(() => c.buscar('/queue/simple', COMMENT))
        assert.instanceOf(error, RouterOSCredenciales)
        assert.equal((error as RouterOSCredenciales).tipo, 'credenciales')
        assert.equal((error as RouterOSCredenciales).status, 401)
        assert.lengthOf(falso.peticiones, 1)
    })

    test('400 de RouterOS con su mensaje, sin reintentos y auditado como fallo', async ({ assert }) => {
        const b = bitacora()
        const c = cliente(falso, b)
        await c.crear('/ip/firewall/address-list', { list: 'suspendidos', address: '10.0.0.9' })
        const error = await capturar(() =>
            c.crear('/ip/firewall/address-list', { list: 'suspendidos', address: '10.0.0.9' }),
        )
        assert.instanceOf(error, RouterOSSolicitud)
        assert.equal((error as RouterOSSolicitud).status, 400)
        assert.equal((error as RouterOSSolicitud).detalle, 'failure: already have such entry')
        assert.lengthOf(b.filas, 2)
        assert.isFalse(b.filas[1]!.ok)
        assert.equal(b.filas[1]!.respuesta.detalle, 'failure: already have such entry')
        assert.equal(b.filas[1]!.respuesta.status, 400)
    })

    test('5xx transitorio: reintenta con backoff y termina bien', async ({ assert }) => {
        const c = cliente(falso)
        falso.fallar(2, 503)
        assert.equal(await accion(c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' })), 'creado')
        assert.lengthOf(falso.tabla('/queue/simple'), 1)
    })

    test('un PUT que llegó pero perdió la respuesta no deja duplicado al reintentar', async ({ assert }) => {
        const c = cliente(falso)
        falso.fallar(1, 500, { despues: true })
        await capturar(() => c.crear('/queue/simple', { target: '10.0.0.7/32', comment: COMMENT }))
        assert.lengthOf(falso.tabla('/queue/simple'), 1, 'el router sí lo creó')
        assert.equal(
            await accion(c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' })),
            'sin_cambios',
        )
        assert.lengthOf(falso.tabla('/queue/simple'), 1)
    })

    test('router caído: inalcanzable tras 1 + 3 intentos; al volver funciona', async ({ assert }) => {
        const c = cliente(falso)
        await falso.caer()
        const error = await capturar(() => c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' }))
        assert.instanceOf(error, RouterOSInalcanzable)
        assert.equal((error as RouterOSInalcanzable).codigo, 'ECONNREFUSED')
        assert.isTrue((error as RouterOSInalcanzable).reintentable)
        await falso.levantar()
        assert.equal(await accion(c.asegurar('/queue/simple', COMMENT, { target: '10.0.0.7/32' })), 'creado')
    })

    test('timeout: inalcanzable con ETIMEDOUT', async ({ assert }) => {
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
        const error = await capturar(() => c.buscar('/queue/simple', COMMENT))
        assert.instanceOf(error, RouterOSInalcanzable)
        assert.equal((error as RouterOSInalcanzable).codigo, 'ETIMEDOUT')
        falso.retrasoMs = 0
        c.cerrar()
    })
})

test.group('RouterOS: credenciales del router (v1) y HTTPS', (group) => {
    let dir: string
    let cert: string
    let falso: RouterOSFalso

    group.setup(async () => {
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
        falso = new RouterOSFalso({ tls: { cert, key: readFileSync(join(dir, 'key.pem'), 'utf8') } })
        await falso.levantar()
        return async () => {
            await falso.cerrar()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    const router = (extra: Record<string, unknown> = {}) => ({
        id: 9,
        host: 'ignorado',
        api_url: falso.url,
        api_usuario: falso.usuario,
        api_password: cifrar(falso.password, CLAVE),
        ...extra,
    })

    test('verifica el certificado por defecto: autofirmado sin CA → error TLS sin reintentos', async ({
        assert,
    }) => {
        const c = clienteDeRouter(router(), { clave: CLAVE, esperaMs: 1 })
        const antes = falso.peticiones.length
        const error = await capturar(() => c.probar())
        assert.instanceOf(error, RouterOSInalcanzable)
        assert.isFalse((error as RouterOSInalcanzable).reintentable)
        assert.equal(falso.peticiones.length, antes)
        c.cerrar()
    })

    test('con la CA del router o con la verificación apagada, conecta y descifra la contraseña v1', async ({
        assert,
    }) => {
        const conCa = clienteDeRouter(router({ api_ca: cert }), { clave: CLAVE })
        assert.equal(await conCa.probar().then((r) => r['board-name']), 'falso')
        const sinVerificar = clienteDeRouter(router({ api_tls_verificar: false }), { clave: CLAVE })
        assert.lengthOf(await sinVerificar.buscar('/queue/simple', COMMENT), 0)
        conCa.cerrar()
        sinVerificar.cerrar()
    })

    test('sin credenciales o con api_password ilegible: RouterSinCredenciales', ({ assert }) => {
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
