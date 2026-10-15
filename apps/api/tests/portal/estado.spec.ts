import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearServicio, crearSesion } from '#tests/portal/ayudas_portal'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'

/**
 * GET /api/v1/portal/estado: estado en vivo de la página de corte, contra Postgres real.
 * Igual que quien-soy, la IP del cliente viaja en X-Forwarded-For desde 127.0.0.1 (proxy confiable).
 */

const RUTA = '/api/v1/portal/estado'
const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

test.group('Portal: estado en vivo por IP', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-estado')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('solo estado y monto adeudado, sin datos personales ni la IP', async ({ client, assert }) => {
        const s = await crearServicio({ nombre: 'Juan Carlos Pérez' })
        await crearSesion(s, { ipv4: '198.51.100.40' })

        const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.40'), 200)
        assert.deepEqual(respuesta.body(), {
            identificado: true,
            estado: 'suspendido',
            monto_adeudado: '399.75',
        })
        assert.equal(respuesta.header('cache-control'), 'no-store')
        const texto = JSON.stringify(respuesta.body())
        for (const dato of ['Juan', 'Pérez', 'example.com', '5555-1234', 'ppp-', '198.51.100.40']) {
            assert.notInclude(texto, dato)
        }
    })

    test('IPv6 del prefijo delegado identifica el mismo servicio', async ({ client, assert }) => {
        const s = await crearServicio({ estado: 'limitado' })
        await crearSesion(s, { ipv4: '198.51.100.41', delegado: '2001:db8:400:100::/56' })

        const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:400:1ab::7'), 200)
        assert.deepEqual(respuesta.body(), {
            identificado: true,
            estado: 'limitado',
            monto_adeudado: '399.75',
        })
    })

    test('IP desconocida: no identificado y sin montos', async ({ client, assert }) => {
        const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '203.0.113.240'), 200)
        assert.deepEqual(respuesta.body(), { identificado: false, estado: null, monto_adeudado: null })
    })

    test('refleja la reactivación en la siguiente consulta', async ({ client, assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.42' })

        const antes = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.42'), 200)
        assert.equal(antes.body().estado, 'suspendido')

        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'activo', motivo: 'promesa aprobada (prueba)' },
            contextoPrueba(),
        )

        const despues = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.42'), 200)
        assert.equal(despues.body().estado, 'activo')
    })

    test('se audita como portal.estado, canal portal, con el servicio', async ({ client, assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.43' })
        const requestId = unico('estado')

        await estado(
            client.get(RUTA).header('X-Forwarded-For', '198.51.100.43').header('X-Request-Id', requestId),
            200,
        )
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.accion, 'portal.estado')
        assert.equal(accion.canal, 'portal')
        assert.equal(accion.entidad_tipo, 'servicio')
        assert.equal(Number(accion.entidad_id), s.servicioId)
    })

    test('tiene su propio contador de límite, aparte de quien-soy', async ({ client }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '2'
        const ip = '198.51.100.44'
        await estado(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip), 200)
        await estado(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip), 200)
        await estado(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip), 429)

        await estado(client.get(RUTA).header('X-Forwarded-For', ip), 200)
        await estado(client.get(RUTA).header('X-Forwarded-For', ip), 200)
        await estado(client.get(RUTA).header('X-Forwarded-For', ip), 429)
    })
})
