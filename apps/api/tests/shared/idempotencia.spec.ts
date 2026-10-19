import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { NoImplementado } from '#shared/errores'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { generarTokenNodo } from '#portal/nodo_portal'

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

// pública (sin auth), como `POST /portal/promesas`
router
    .post('/__pruebas/idempotente-publica', async ({ request, response }) => {
        ejecuciones++
        response.status(201)
        return { ejecucion: ejecuciones, eco: request.body() }
    })
    .use([middleware.idempotencia()])

// multipart, como `POST /portal/comprobantes`
router
    .post('/__pruebas/idempotente-multipart', async ({ request, response }) => {
        ejecuciones++
        response.status(201)
        const archivo = request.file('archivo')
        return {
            ejecucion: ejecuciones,
            referencia: request.input('referencia'),
            tamano: archivo?.size ?? null,
        }
    })
    .use([middleware.idempotencia()])

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

    test('pública: la clave se acota por sesión del portal; sin sesión, por IP de origen', async ({
        client,
        assert,
    }) => {
        const clave = unico('clave-publica')
        const enviar = (cabeceras: Record<string, string>) => {
            const peticion = client.post('/__pruebas/idempotente-publica').header('Idempotency-Key', clave)
            for (const [nombre, valor] of Object.entries(cabeceras)) peticion.header(nombre, valor)
            return peticion.json({ servicio_id: 1 })
        }

        // dos sesiones distintas con la misma clave y el mismo cuerpo: cada una ejecuta
        const a = await estado(enviar({ Cookie: 'argos_portal=pses_sesion-a' }), 201)
        const b = await estado(enviar({ Cookie: 'argos_portal=pses_sesion-b' }), 201)
        assert.notEqual(a.body().ejecucion, b.body().ejecucion)
        // la misma sesión repite su respuesta
        const repetida = await estado(enviar({ Cookie: 'argos_portal=pses_sesion-a' }), 201)
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        assert.deepEqual(repetida.body(), a.body())
        assert.equal(ejecuciones, 2)

        // sin cookie, por IP de origen (detrás de un proxy confiable)
        const previos = {
            PORTAL_PROXIES_CONFIABLES: process.env.PORTAL_PROXIES_CONFIABLES,
            PORTAL_CABECERA_IP: process.env.PORTAL_CABECERA_IP,
        }
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1/128'
        process.env.PORTAL_CABECERA_IP = 'x-forwarded-for'
        try {
            await estado(enviar({ 'X-Forwarded-For': '198.51.100.7' }), 201)
            await estado(enviar({ 'X-Forwarded-For': '198.51.100.8' }), 201)
            const misma = await estado(enviar({ 'X-Forwarded-For': '198.51.100.7' }), 201)
            assert.equal(misma.header('idempotent-replayed'), 'true')
        } finally {
            for (const [nombre, valor] of Object.entries(previos)) {
                if (valor === undefined) delete process.env[nombre]
                else process.env[nombre] = valor
            }
        }
        assert.equal(ejecuciones, 4)

        // en la tabla solo quedan hashes: ni el token de sesión ni la IP
        const filas = await db.from('core.idempotency_keys').where('clave', clave)
        assert.lengthOf(filas, 4)
        for (const fila of filas) {
            assert.isNull(fila.actor_id)
            assert.match(fila.alcance, /^(sesion|ip):[0-9a-f]{40}$/)
        }
        assert.isFalse(JSON.stringify(filas.map((f) => f.alcance)).includes('198.51.100'))
    })

    test('detrás de un nodo portal la clave se acota por la IP del cliente, no la del nodo', async ({
        client,
        assert,
    }) => {
        const { valor: token, hash } = generarTokenNodo()
        await db.table('core.nodos_portal').insert({ nombre: unico('nodo').toLowerCase(), hash })
        const clave = unico('clave-nodo')
        const enviar = (ipCliente: string, tokenNodo = token) =>
            client
                .post('/__pruebas/idempotente-publica')
                .header('Idempotency-Key', clave)
                .header('X-Argos-Nodo-Token', tokenNodo)
                .header('X-Argos-Cliente-Ip', ipCliente)
                .json({ servicio_id: 1 })

        // dos clientes distintos detrás del mismo nodo (misma IP de socket), misma clave y cuerpo
        const a = await estado(enviar('198.51.100.91'), 201)
        const b = await estado(enviar('198.51.100.92'), 201)
        assert.isUndefined(b.header('idempotent-replayed'))
        assert.notEqual(a.body().ejecucion, b.body().ejecucion)
        // el mismo cliente sí recibe su respuesta guardada
        const repetida = await estado(enviar('198.51.100.91'), 201)
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        assert.deepEqual(repetida.body(), a.body())
        assert.equal(ejecuciones, 2)
        assert.lengthOf(await db.from('core.idempotency_keys').where('clave', clave), 2)

        // un token de nodo inventado no se usa para elegir el alcance: 401 antes de ejecutar
        const falso = await estado(enviar('198.51.100.91', 'argn_inventado-no-existe-0000000000000000'), 401)
        assert.include(falso.body().type, 'nodo_portal_invalido')
        assert.equal(ejecuciones, 2)
    })

    test('autenticado: el alcance queda null y manda el actor', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const clave = unico('clave')
        await estado(
            client
                .post('/__pruebas/idempotente')
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .header('Cookie', 'argos_portal=pses_cualquiera')
                .json({}),
            201,
        )
        const fila = await db.from('core.idempotency_keys').where('clave', clave).firstOrFail()
        assert.isNull(fila.alcance)
        assert.isNotNull(fila.actor_id)
    })

    test('multipart: la huella incluye el contenido de los archivos', async ({ client, assert }) => {
        const clave = unico('clave-multipart')
        const enviar = (contenido: string, nombre = 'deposito.png') =>
            client
                .post('/__pruebas/idempotente-multipart')
                .header('Idempotency-Key', clave)
                .header('Cookie', 'argos_portal=pses_multipart')
                .field('referencia', 'BOLETA-1')
                .file('archivo', Buffer.from(contenido), { filename: nombre })

        const primera = await estado(enviar('imagen-uno'), 201)
        assert.equal(primera.body().referencia, 'BOLETA-1')
        // mismo archivo: repite la respuesta sin ejecutar
        const repetida = await estado(enviar('imagen-uno'), 201)
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        assert.equal(ejecuciones, 1)

        // mismos campos y mismo nombre, otro contenido (mismo tamaño): 422, no la respuesta guardada
        const otra = await estado(enviar('imagen-dos'), 422)
        assert.equal(otra.body().type, 'urn:argosisp:problema:idempotency_key_reutilizada')
        // otro nombre de archivo con el mismo contenido también es otro cuerpo
        await estado(enviar('imagen-uno', 'otro.png'), 422)
        assert.equal(ejecuciones, 1)
    })
})
