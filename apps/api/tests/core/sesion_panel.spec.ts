import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { configOrigenes, origenPermitido } from '#core/auth/origenes'
import { cookieSegura, csrfDeSesion } from '#core/auth/sesion_panel'

/**
 * Sesión del panel en cookie HttpOnly (`POST /auth/sesion`), CSRF, logout, Bearer intacto y CORS.
 * Contrato: `.claude/integration/contratos/sesion-panel.md`.
 */

const PANEL = 'http://localhost:3000'

interface CookieSesion {
    valor: string
    atributos: string[]
    crudo: string
}

function cookieDe(setCookie: string | string[] | undefined, nombre = 'argos_sesion'): CookieSesion | null {
    const lista = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    const crudo = lista.find((c) => c.startsWith(`${nombre}=`))
    if (!crudo) return null
    const [par, ...atributos] = crudo.split(';').map((p) => p.trim())
    return { valor: par!.slice(nombre.length + 1), atributos: atributos.map((a) => a.toLowerCase()), crudo }
}

async function sesionPanel(client: ApiClient) {
    const { usuario, password } = await usuarioConRoles(['admin'])
    const respuesta = await estado(
        client.post('/api/v1/auth/sesion').header('Origin', PANEL).json({ email: usuario.email, password }),
        200,
    )
    const cookie = cookieDe(respuesta.header('set-cookie'))!
    return {
        usuario,
        cookie: `argos_sesion=${cookie.valor}`,
        csrf: respuesta.body().csrf as string,
        respuesta,
    }
}

test.group('Sesión del panel: login con cookie HttpOnly', () => {
    test('pone la cookie HttpOnly, Secure, SameSite=Strict, Path=/api y no devuelve el token', async ({
        client,
        assert,
    }) => {
        const { respuesta, usuario } = await sesionPanel(client)
        const cookie = cookieDe(respuesta.header('set-cookie'))!
        assert.match(cookie.valor, /^oat_/)
        assert.includeMembers(cookie.atributos, ['httponly', 'secure', 'samesite=strict', 'path=/api'])
        assert.isTrue(cookie.atributos.some((a) => a.startsWith('max-age=')))

        const cuerpo = respuesta.body()
        assert.notProperty(cuerpo, 'token')
        assert.notInclude(JSON.stringify(cuerpo), cookie.valor)
        assert.equal(cuerpo.csrf, csrfDeSesion(cookie.valor))
        assert.equal(cuerpo.usuario.email, usuario.email)
        assert.equal(cuerpo.usuario.csrf, cuerpo.csrf)
        assert.isString(cuerpo.expira_en)
    })

    test('GET /me con la cookie responde el usuario y su csrf', async ({ client, assert }) => {
        const { cookie, csrf, usuario } = await sesionPanel(client)
        const me = await estado(client.get('/api/v1/me').header('Cookie', cookie), 200)
        assert.equal(me.body().id, usuario.id)
        assert.equal(me.body().csrf, csrf)
    })

    test('la acción hecha con la cookie queda auditada con el usuario y canal panel', async ({
        client,
        assert,
    }) => {
        const { cookie, csrf, usuario } = await sesionPanel(client)
        const requestId = unico('panel-cookie')
        await estado(
            client
                .post('/api/v1/zonas')
                .header('Cookie', cookie)
                .header('X-CSRF-Token', csrf)
                .header('Origin', PANEL)
                .header('X-Request-Id', requestId)
                .json({ nombre: unico('Zona') }),
            201,
        )
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.actor_tipo, 'usuario')
        assert.equal(Number(accion.actor_id), usuario.id)
        assert.equal(accion.canal, 'panel')
    })

    test('credenciales inválidas → 401 y sin cookie', async ({ client, assert }) => {
        const respuesta = await estado(
            client.post('/api/v1/auth/sesion').json({ email: 'admin@argosisp.local', password: 'mala' }),
            401,
        )
        assert.isNull(cookieDe(respuesta.header('set-cookie')))
    })

    test('login desde un origen no permitido o sin JSON → 403 csrf_invalido', async ({ client, assert }) => {
        const { usuario, password } = await usuarioConRoles(['lectura'])
        const ajeno = await estado(
            client
                .post('/api/v1/auth/sesion')
                .header('Origin', 'https://malo.example')
                .json({ email: usuario.email, password }),
            403,
        )
        assert.equal(ajeno.body().type, 'urn:argosisp:problema:csrf_invalido')
        assert.isNull(cookieDe(ajeno.header('set-cookie')))

        const formulario = await estado(
            client.post('/api/v1/auth/sesion').form({ email: usuario.email, password }),
            403,
        )
        assert.equal(formulario.body().type, 'urn:argosisp:problema:csrf_invalido')
    })
})

test.group('Sesión del panel: CSRF', () => {
    test('POST con la cookie sin X-CSRF-Token → 403 y no ejecuta la acción', async ({ client, assert }) => {
        const { cookie } = await sesionPanel(client)
        const nombre = unico('Zona')
        const respuesta = await estado(
            client.post('/api/v1/zonas').header('Cookie', cookie).header('Origin', PANEL).json({ nombre }),
            403,
        )
        assert.equal(respuesta.header('content-type'), 'application/problem+json; charset=utf-8')
        assert.equal(respuesta.body().type, 'urn:argosisp:problema:csrf_invalido')
        assert.isNull(await db.from('core.zonas').where('nombre', nombre).first())
    })

    test('X-CSRF-Token de otra sesión → 403', async ({ client }) => {
        const a = await sesionPanel(client)
        const b = await sesionPanel(client)
        await estado(
            client
                .post('/api/v1/zonas')
                .header('Cookie', a.cookie)
                .header('X-CSRF-Token', b.csrf)
                .json({ nombre: unico('Zona') }),
            403,
        )
    })

    test('token correcto pero Origin no permitido → 403', async ({ client }) => {
        const { cookie, csrf } = await sesionPanel(client)
        await estado(
            client
                .post('/api/v1/zonas')
                .header('Cookie', cookie)
                .header('X-CSRF-Token', csrf)
                .header('Origin', 'https://localhost.malo.example')
                .json({ nombre: unico('Zona') }),
            403,
        )
    })

    test('GET no exige X-CSRF-Token', async ({ client }) => {
        const { cookie } = await sesionPanel(client)
        await estado(client.get('/api/v1/zonas').header('Cookie', cookie), 200)
    })

    test('la cookie respeta el ACL: lectura recibe 403 de permiso', async ({ client, assert }) => {
        const { usuario, password } = await usuarioConRoles(['lectura'])
        const login = await estado(
            client.post('/api/v1/auth/sesion').json({ email: usuario.email, password }),
            200,
        )
        const cookie = `argos_sesion=${cookieDe(login.header('set-cookie'))!.valor}`
        const respuesta = await estado(
            client
                .post('/api/v1/zonas')
                .header('Cookie', cookie)
                .header('X-CSRF-Token', login.body().csrf)
                .json({ nombre: unico('Zona') }),
            403,
        )
        assert.notEqual(respuesta.body().type, 'urn:argosisp:problema:csrf_invalido')
    })
})

test.group('Sesión del panel: logout', () => {
    test('revoca la sesión y borra la cookie', async ({ client, assert }) => {
        const { cookie, csrf } = await sesionPanel(client)
        // sin CSRF el logout también se rechaza
        await estado(client.post('/api/v1/auth/logout').header('Cookie', cookie), 403)

        const respuesta = await estado(
            client.post('/api/v1/auth/logout').header('Cookie', cookie).header('X-CSRF-Token', csrf),
            204,
        )
        const borrada = cookieDe(respuesta.header('set-cookie'))!
        assert.equal(borrada.valor, '')
        assert.include(borrada.atributos, 'path=/api')
        assert.isTrue(
            borrada.atributos.some((a) => a === 'max-age=-1' || a.startsWith('expires=thu, 01 jan 1970')),
        )

        await estado(client.get('/api/v1/me').header('Cookie', cookie), 401)
    })
})

test.group('Sesión del panel: Bearer intacto', () => {
    test('POST /auth/login sigue devolviendo el token y Bearer no exige CSRF', async ({ client, assert }) => {
        const { usuario, password } = await usuarioConRoles(['admin'])
        const login = await estado(
            client.post('/api/v1/auth/login').json({ email: usuario.email, password }),
            200,
        )
        assert.match(login.body().token, /^oat_/)
        assert.notProperty(login.body(), 'expiraEn')
        assert.isNull(cookieDe(login.header('set-cookie')))

        await estado(
            client
                .post('/api/v1/zonas')
                .bearerToken(login.body().token)
                .json({ nombre: unico('Zona') }),
            201,
        )
        const me = await estado(client.get('/api/v1/me').bearerToken(login.body().token), 200)
        assert.notProperty(me.body(), 'csrf')

        await estado(client.post('/api/v1/auth/logout').bearerToken(login.body().token), 204)
        await estado(client.get('/api/v1/me').bearerToken(login.body().token), 401)
    })

    test('Bearer explícito gana sobre la cookie y nunca se mezclan', async ({ client }) => {
        const { cookie } = await sesionPanel(client)
        // Bearer inválido con cookie válida → 401 (no cae a la cookie)
        await estado(client.get('/api/v1/me').bearerToken('oat_invalido').header('Cookie', cookie), 401)
        // Bearer válido con cookie → POST sin CSRF pasa (autenticó el Bearer)
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post('/api/v1/zonas')
                .bearerToken(token)
                .header('Cookie', cookie)
                .json({ nombre: unico('Zona') }),
            201,
        )
    })

    test('una cookie con un token inventado → 401', async ({ client }) => {
        await estado(client.get('/api/v1/me').header('Cookie', 'argos_sesion=oat_no-existe'), 401)
    })
})

test.group('Sesión del panel: CORS con credenciales', () => {
    test('preflight desde un origen permitido devuelve el origen y credenciales', async ({
        client,
        assert,
    }) => {
        const respuesta = await client
            .options('/api/v1/zonas')
            .header('Origin', PANEL)
            .header('Access-Control-Request-Method', 'POST')
            .header('Access-Control-Request-Headers', 'content-type,x-csrf-token')
        assert.equal(respuesta.header('access-control-allow-origin'), PANEL)
        assert.equal(respuesta.header('access-control-allow-credentials'), 'true')
        assert.include(String(respuesta.header('access-control-allow-headers')).toLowerCase(), 'x-csrf-token')
    })

    test('un origen no permitido no recibe Access-Control-Allow-Origin', async ({ client, assert }) => {
        const preflight = await client
            .options('/api/v1/zonas')
            .header('Origin', 'https://malo.example')
            .header('Access-Control-Request-Method', 'POST')
        assert.isUndefined(preflight.header('access-control-allow-origin'))

        const { cookie } = await sesionPanel(client)
        const lectura = await client
            .get('/api/v1/me')
            .header('Cookie', cookie)
            .header('Origin', 'https://malo.example')
        assert.isUndefined(lectura.header('access-control-allow-origin'))
    })

    test('origenPermitido: lista explícita, localhost solo fuera de producción, mismo host', ({ assert }) => {
        const conLista = configOrigenes({ CORS_ORIGINS: 'https://panel.isp.gt/, http://localhost:3000' })
        assert.deepEqual(conLista.lista, ['https://panel.isp.gt', 'http://localhost:3000'])
        assert.isTrue(origenPermitido('https://PANEL.isp.gt', null, conLista))
        assert.isFalse(origenPermitido('https://otro.isp.gt', null, conLista))
        assert.isFalse(origenPermitido('http://localhost:4000', null, conLista))

        const dev = configOrigenes({ NODE_ENV: 'development' })
        assert.isTrue(origenPermitido('http://localhost:4000', null, dev))
        assert.isTrue(origenPermitido('http://127.0.0.1:3000', null, dev))
        assert.isFalse(origenPermitido('http://localhost.malo.example', null, dev))
        assert.isFalse(origenPermitido('null', null, dev))

        const produccion = configOrigenes({ NODE_ENV: 'production' })
        assert.isFalse(origenPermitido('http://localhost:3000', null, produccion))
        assert.isTrue(origenPermitido('https://isp.gt', 'isp.gt', produccion))
    })

    test('Secure configurable solo con PANEL_COOKIE_SEGURA=false', ({ assert }) => {
        assert.isTrue(cookieSegura({}))
        assert.isTrue(cookieSegura({ PANEL_COOKIE_SEGURA: 'true' }))
        assert.isFalse(cookieSegura({ PANEL_COOKIE_SEGURA: 'false' }))
    })
})
