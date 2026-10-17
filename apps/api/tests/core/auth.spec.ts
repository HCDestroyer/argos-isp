import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { NOMBRES_PERMISOS } from '#core/permisos'
import { estado, usuarioConRoles } from '#tests/ayudas'

const PROBLEM_JSON = 'application/problem+json; charset=utf-8'

test.group('Auth: login y /me', () => {
    test('login con el admin del seed devuelve token y Me', async ({ client, assert }) => {
        const respuesta = await estado(
            client.post('/api/v1/auth/login').json({ email: 'ADMIN@argosisp.local', password: 'admin12345' }),
            200,
        )
        const cuerpo = respuesta.body()
        assert.match(cuerpo.token, /^oat_/)
        assert.properties(cuerpo.usuario, ['id', 'nombre', 'email', 'roles', 'permisos'])
        assert.deepEqual(cuerpo.usuario.roles, ['admin'])
        assert.sameMembers(cuerpo.usuario.permisos, NOMBRES_PERMISOS)

        const me = await estado(client.get('/api/v1/me').bearerToken(cuerpo.token), 200)
        const { expira_en: expiraEn, expira_max_en: expiraMaxEn, ...usuarioMe } = me.body()
        assert.deepEqual(usuarioMe, cuerpo.usuario)
        // Bearer de login: vencimiento fijo (ACCESS_TOKEN_EXPIRA), el tope es el mismo
        assert.isString(expiraEn)
        assert.equal(expiraMaxEn, expiraEn)
        assert.exists(me.header('x-request-id'))
    })

    test('el login queda en la bitácora con la contraseña enmascarada', async ({ client, assert }) => {
        const requestId = `prueba-login-${Date.now()}`
        await estado(
            client
                .post('/api/v1/auth/login')
                .header('X-Request-Id', requestId)
                .header('X-Canal', 'panel')
                .json({ email: 'admin@argosisp.local', password: 'admin12345' }),
            200,
        )

        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.accion, 'auth.login')
        assert.equal(accion.canal, 'panel')
        assert.equal(accion.resultado, 'ok')
        assert.deepEqual(accion.entrada, { email: 'admin@argosisp.local', password: '***' })
        // el actor es el usuario que inició sesión, no "Sistema"
        const admin = await db.from('core.usuarios').where('email', 'admin@argosisp.local').firstOrFail()
        assert.equal(accion.actor_tipo, 'usuario')
        assert.equal(Number(accion.actor_id), Number(admin.id))
        assert.equal(Number(accion.entidad_id), Number(admin.id))
    })

    test('un login fallido queda auditado como error con actor sistema', async ({ client, assert }) => {
        const requestId = `prueba-login-fallido-${Date.now()}`
        await estado(
            client
                .post('/api/v1/auth/login')
                .header('X-Request-Id', requestId)
                .json({ email: 'admin@argosisp.local', password: 'incorrecta' }),
            401,
        )
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.resultado, 'error')
        assert.equal(accion.actor_tipo, 'sistema')
        assert.isNull(accion.actor_id)
    })

    test('credenciales inválidas → 401 Problem', async ({ client, assert }) => {
        const respuesta = await estado(
            client.post('/api/v1/auth/login').json({ email: 'admin@argosisp.local', password: 'incorrecta' }),
            401,
        )
        assert.equal(respuesta.header('content-type'), PROBLEM_JSON)
        assert.containsSubset(respuesta.body(), {
            type: 'urn:argosisp:problema:credenciales_invalidas',
            status: 401,
        })
    })

    test('datos mal formados → 422 Problem con errors[] en español', async ({ client, assert }) => {
        const respuesta = await estado(client.post('/api/v1/auth/login').json({ email: 'no-es-correo' }), 422)
        assert.equal(respuesta.header('content-type'), PROBLEM_JSON)
        const cuerpo = respuesta.body()
        assert.equal(cuerpo.type, 'urn:argosisp:problema:validacion')
        assert.sameMembers(
            cuerpo.errors.map((e: { field: string }) => e.field),
            ['email', 'password'],
        )
        assert.include(cuerpo.errors[0].message, 'El campo')
    })

    test('/me sin token → 401 Problem', async ({ client, assert }) => {
        const respuesta = await estado(client.get('/api/v1/me'), 401)
        assert.equal(respuesta.header('content-type'), PROBLEM_JSON)
        assert.containsSubset(respuesta.body(), { type: 'urn:argosisp:problema:no_autenticado', status: 401 })
    })

    test('logout revoca el token', async ({ client }) => {
        const { token } = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/me').bearerToken(token), 200)
        await estado(client.post('/api/v1/auth/logout').bearerToken(token), 204)
        await estado(client.get('/api/v1/me').bearerToken(token), 401)
    })
})
