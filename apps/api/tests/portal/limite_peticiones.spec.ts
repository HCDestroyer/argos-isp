import { setTimeout as esperar } from 'node:timers/promises'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { estado, unico } from '#tests/ayudas'
import { claveDeIp, configLimite, limitarPorIp, type LimitePeticiones } from '#portal/limite_peticiones'

/**
 * Límite de peticiones por IP de `GET /api/v1/portal/quien-soy` contra Redis real.
 * Cada prueba usa un prefijo de claves propio para no compartir contadores entre corridas.
 */

const RUTA = '/api/v1/portal/quien-soy'
const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_LIMITE_PETICIONES',
    'PORTAL_LIMITE_VENTANA_S',
    'PORTAL_REDIS_PREFIJO',
] as const

test.group('Portal: límite de peticiones por IP', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_LIMITE_PETICIONES = '3'
        process.env.PORTAL_LIMITE_VENTANA_S = '60'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-limite')
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('pasado el límite responde 429 problem+json con Retry-After', async ({ client, assert }) => {
        const ip = '198.51.100.200'
        for (let i = 1; i <= 3; i += 1) {
            const ok = await estado(client.get(RUTA).header('X-Forwarded-For', ip), 200)
            assert.equal(ok.header('ratelimit-limit'), '3')
            assert.equal(ok.header('ratelimit-remaining'), String(3 - i))
        }

        const requestId = unico('limite')
        const bloqueada = await estado(
            client.get(RUTA).header('X-Forwarded-For', ip).header('X-Request-Id', requestId),
            429,
        )
        assert.match(bloqueada.header('content-type') ?? '', /^application\/problem\+json/)
        assert.containsSubset(bloqueada.body(), {
            type: 'urn:argosisp:problema:demasiadas_peticiones',
            title: 'Demasiadas peticiones',
            status: 429,
        })
        const reintentar = Number(bloqueada.header('retry-after'))
        assert.isTrue(Number.isInteger(reintentar) && reintentar >= 1 && reintentar <= 60)
        assert.equal(bloqueada.header('ratelimit-remaining'), '0')

        // La petición bloqueada no llega a la acción: no identifica ni audita.
        const auditada = await db.from('audit.acciones').where('request_id', requestId).first()
        assert.isNull(auditada)
    })

    test('cada IPv4 cuenta aparte', async ({ client }) => {
        for (let i = 0; i < 3; i += 1) {
            await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.201'), 200)
        }
        await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.201'), 429)
        await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.202'), 200)
    })

    test('IPv6: el mismo /64 comparte contador y otro /64 no', async ({ client }) => {
        await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:aa:1::1'), 200)
        await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:aa:1::2'), 200)
        await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:aa:1:ffff::3'), 200)
        await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:aa:1::4'), 429)
        await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:aa:2::1'), 200)
    })

    test('al terminar la ventana vuelve a dejar pasar', async ({ client }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '1'
        process.env.PORTAL_LIMITE_VENTANA_S = '1'
        const ip = '198.51.100.203'
        await estado(client.get(RUTA).header('X-Forwarded-For', ip), 200)
        await estado(client.get(RUTA).header('X-Forwarded-For', ip), 429)
        await esperar(1100)
        await estado(client.get(RUTA).header('X-Forwarded-For', ip), 200)
    }).timeout(5000)

    test('PORTAL_LIMITE_PETICIONES=0 lo apaga', async ({ client, assert }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '0'
        for (let i = 0; i < 5; i += 1) {
            const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.204'), 200)
            assert.isUndefined(respuesta.header('ratelimit-limit'))
        }
    })

    test('si Redis falla la petición pasa', async ({ assert }) => {
        const cabeceras: Record<string, string> = {}
        const ctx = {
            response: { header: (nombre: string, valor: string) => (cabeceras[nombre] = valor) },
        } as unknown as HttpContext
        const roto = {
            contar: async () => {
                throw new Error('ECONNREFUSED')
            },
        } as unknown as LimitePeticiones

        await limitarPorIp(ctx, 'quien-soy', '198.51.100.205', roto)
        assert.deepEqual(cabeceras, {})
    })
})

test.group('Portal: configuración y claves del límite', () => {
    test('valores por defecto y validación', ({ assert }) => {
        assert.deepEqual(configLimite({}), { peticiones: 30, ventanaS: 60, prefijo: 'argosisp' })
        assert.deepEqual(
            configLimite({
                PORTAL_LIMITE_PETICIONES: '10',
                PORTAL_LIMITE_VENTANA_S: '30',
                COLAS_PREFIJO: 'ci',
            }),
            { peticiones: 10, ventanaS: 30, prefijo: 'ci' },
        )
        assert.throws(() => configLimite({ PORTAL_LIMITE_PETICIONES: 'muchas' }), /PORTAL_LIMITE_PETICIONES/)
        assert.throws(() => configLimite({ PORTAL_LIMITE_VENTANA_S: '0' }), /PORTAL_LIMITE_VENTANA_S/)
    })

    test('IPv4 tal cual; IPv6 agrupada por /64', ({ assert }) => {
        assert.equal(claveDeIp('198.51.100.1'), '198.51.100.1')
        assert.equal(claveDeIp('2001:db8:1:2:a00:27ff:fe4e:66a1'), '2001:db8:1:2::/64')
        assert.equal(claveDeIp('2001:db8::1'), '2001:db8:0:0::/64')
        assert.equal(claveDeIp('2001:0DB8:0001:0002::'), '2001:db8:1:2::/64')
        assert.equal(claveDeIp('::1'), '0:0:0:0::/64')
        assert.equal(claveDeIp('64:ff9b::198.51.100.1'), '64:ff9b:0:0::/64')
        assert.isNull(claveDeIp('no-es-ip'))
    })
})
