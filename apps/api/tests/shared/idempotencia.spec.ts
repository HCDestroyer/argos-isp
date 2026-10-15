import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { NoImplementado } from '#shared/errores'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

/**
 * Rutas solo de prueba para el middleware de idempotencia (se registran antes de que el
 * servidor de pruebas haga commit del router).
 */
let ejecuciones = 0
router
    .post('/__pruebas/idempotente', async ({ request, response }) => {
        ejecuciones++
        response.status(201)
        return { ejecucion: ejecuciones, eco: request.body() }
    })
    .use([middleware.auth(), middleware.idempotencia()])
router
    .post('/__pruebas/idempotente-falla', async () => {
        ejecuciones++
        throw new NoImplementado('prueba')
    })
    .use([middleware.auth(), middleware.idempotencia()])

test.group('Idempotency-Key', (group) => {
    group.each.setup(() => {
        ejecuciones = 0
    })

    test('repite la respuesta guardada sin volver a ejecutar', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const clave = unico('clave')
        const enviar = () =>
            client
                .post('/__pruebas/idempotente')
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ monto: '10.00' })

        const primera = await estado(enviar(), 201)
        assert.isUndefined(primera.header('idempotent-replayed'))

        const segunda = await estado(enviar(), 201)
        assert.equal(segunda.header('idempotent-replayed'), 'true')
        assert.deepEqual(segunda.body(), primera.body())
        assert.equal(ejecuciones, 1)
    })

    test('la misma clave con otro cuerpo → 422 Problem', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const clave = unico('clave')
        const enviar = (monto: string) =>
            client
                .post('/__pruebas/idempotente')
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ monto })

        await estado(enviar('10.00'), 201)
        const otra = await estado(enviar('99.00'), 422)
        assert.equal(otra.body().type, 'urn:argosisp:problema:idempotency_key_reutilizada')
        assert.equal(ejecuciones, 1)
    })

    test('la clave es por actor: otro usuario con la misma clave ejecuta', async ({ client, assert }) => {
        const a = await usuarioConRoles(['cajero'])
        const b = await usuarioConRoles(['cajero'])
        const clave = unico('clave')
        for (const { token } of [a, b]) {
            await estado(
                client
                    .post('/__pruebas/idempotente')
                    .bearerToken(token)
                    .header('Idempotency-Key', clave)
                    .json({}),
                201,
            )
        }
        assert.equal(ejecuciones, 2)
    })

    test('si la operación falla, la clave se libera y se puede reintentar', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const clave = unico('clave')
        for (let i = 0; i < 2; i++) {
            await estado(
                client
                    .post('/__pruebas/idempotente-falla')
                    .bearerToken(token)
                    .header('Idempotency-Key', clave)
                    .json({}),
                501,
            )
        }
        assert.equal(ejecuciones, 2)
    })

    test('sin header la petición se ejecuta siempre', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        await estado(client.post('/__pruebas/idempotente').bearerToken(token).json({}), 201)
        await estado(client.post('/__pruebas/idempotente').bearerToken(token).json({}), 201)
        assert.equal(ejecuciones, 2)
    })
})
