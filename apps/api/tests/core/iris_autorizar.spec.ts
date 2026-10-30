import { test } from '@japa/runner'
import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { usuarioIris } from '#core/integraciones_iris'

/**
 * «Conectar con un botón» (contrato Iris 0.4.0, §1.4): autorización desde el panel de Argos con
 * `state` y PKCE S256, vista previa para la pantalla, canje con `code_verifier` y `panel_url`.
 */

const ARGOS = 'https://argos.isp.example'
const PANEL = 'https://panel.isp.example'
const IRIS = 'https://iris.isp.example'
const BASE = '/api/v1/integraciones/iris'
const TOKEN_IRIS = `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`
const SECRETO_IRIS = 'secreto-del-receptor-de-iris-0123456789'

function pkce() {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    return { verifier, challenge }
}

function nuevoState() {
    return randomBytes(32).toString('base64url')
}

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: IRIS,
        token: TOKEN_IRIS,
        webhook: { url: `${IRIS}/api/v1/integraciones/argosisp/webhook/c-1`, secreto: SECRETO_IRIS },
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function fijarConector(urlBase: string) {
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: false,
        url_base: urlBase,
        token_cifrado: cifrar(TOKEN_IRIS),
    })
}

/** Lee el fragmento de `redirigir_a`. */
function fragmento(redirigirA: string): URLSearchParams {
    return new URLSearchParams(redirigirA.split('#')[1] ?? '')
}

async function autorizar(
    client: any,
    admin: string,
    datos: Record<string, unknown> = {},
): Promise<{ codigo: string; verifier: string; state: string; redirigir_a: string }> {
    const { verifier, challenge } = pkce()
    const state = nuevoState()
    const r = await estado(
        client
            .post(`${BASE}/autorizar`)
            .bearerToken(admin)
            .json({ iris: IRIS, state, code_challenge: challenge, code_challenge_method: 'S256', ...datos }),
        200,
    )
    const redirigirA = r.body().redirigir_a as string
    return { codigo: fragmento(redirigirA).get('codigo')!, verifier, state, redirigir_a: redirigirA }
}

test.group('integraciones · iris · conectar con un botón (§1.4)', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        process.env.PANEL_URL_PUBLICA = PANEL
        delete process.env.ARGOSISP_IRIS_ORIGENES
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            delete process.env.PANEL_URL_PUBLICA
            delete process.env.ARGOSISP_IRIS_ORIGENES
            delete process.env.IRIS_PERMITIR_HTTP
        }
    })

    test('origen conocido por el conector: redirigir_a con código, API y state en el fragmento', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await fijarConector(`${IRIS}/api/v1`)
        const { verifier, challenge } = pkce()
        const state = `${nuevoState()}.~-_`
        const r = await estado(
            client.post(`${BASE}/autorizar`).bearerToken(admin).json({
                iris: 'https://IRIS.isp.example/',
                state,
                code_challenge: challenge,
                code_challenge_method: 'S256',
            }),
            200,
        )
        const redirigirA = r.body().redirigir_a as string
        const [antes, despues] = redirigirA.split('#')
        assert.equal(antes, `${IRIS}/administracion/integraciones/argos/vuelta`)
        assert.match(despues!, /^codigo=[A-Za-z0-9_-]{43}&api=https%3A%2F%2Fargos\.isp\.example&state=/)
        const f = fragmento(redirigirA)
        assert.equal(f.get('api'), ARGOS)
        assert.equal(f.get('state'), state)

        const fila = await db.from('integraciones.iris_enlaces').firstOrFail()
        assert.equal(fila.code_challenge, challenge)
        assert.equal(fila.origen_iris, IRIS)
        assert.equal(fila.base_url, ARGOS)
        assert.equal(fila.codigo_sha256, createHash('sha256').update(f.get('codigo')!).digest('hex'))
        assert.notInclude(JSON.stringify(fila), f.get('codigo')!)
        const minutos = (new Date(fila.vence_en).getTime() - Date.now()) / 60_000
        assert.isAbove(minutos, 14)
        assert.isAtMost(minutos, 15)

        // el canje con el verifier correcto conecta y responde panel_url
        const c = await estado(
            client
                .post(`${BASE}/conexion/canjear`)
                .json(canje(f.get('codigo')!, { code_verifier: verifier })),
            200,
        )
        assert.match(c.body().token, /^atk_/)
        assert.equal(c.body().panel_url, PANEL)
        const conector = await db.from('integraciones.iris_conector').where('id', 1).firstOrFail()
        assert.isFalse(conector.activo)

        // la misma petición repetida recibe la misma respuesta (con panel_url)
        const repetida = await estado(
            client
                .post(`${BASE}/conexion/canjear`)
                .json(canje(f.get('codigo')!, { code_verifier: verifier })),
            200,
        )
        assert.deepEqual(repetida.body(), c.body())
    })

    test('origen conocido por ARGOSISP_IRIS_ORIGENES; http solo con IRIS_PERMITIR_HTTP', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        process.env.ARGOSISP_IRIS_ORIGENES = 'https://otro.example   https://iris.isp.example:8443 no-es-url'
        const { redirigir_a: redirigirA } = await autorizar(client, admin, {
            iris: 'https://iris.isp.example:8443',
        })
        assert.isTrue(redirigirA.startsWith('https://iris.isp.example:8443/administracion/'))

        const vista = await estado(
            client
                .get(`${BASE}/autorizar/vista-previa`)
                .bearerToken(admin)
                .qs({ iris: 'https://iris.isp.example:8443/' }),
            200,
        )
        assert.equal(vista.body().origen_normalizado, 'https://iris.isp.example:8443')
        assert.isTrue(vista.body().origen_conocido)

        // http: inválido sin el flag; con el flag, válido (y desconocido)
        const { challenge } = pkce()
        const http = {
            iris: 'http://iris.lab:8080',
            state: nuevoState(),
            code_challenge: challenge,
            code_challenge_method: 'S256',
        }
        const r = await estado(client.post(`${BASE}/autorizar`).bearerToken(admin).json(http), 422)
        assert.equal(r.body().type, 'urn:argosisp:problema:iris_origen_invalido')
        process.env.IRIS_PERMITIR_HTTP = 'true'
        process.env.ARGOSISP_IRIS_ORIGENES = 'http://iris.lab:8080'
        const ok = await estado(client.post(`${BASE}/autorizar`).bearerToken(admin).json(http), 200)
        assert.isTrue((ok.body().redirigir_a as string).startsWith('http://iris.lab:8080/administracion/'))
    })

    test('origen desconocido: 422 iris_origen_no_confirmado sin confirmar o con otro host; con su host, 200', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await fijarConector('https://otro-iris.example')
        const { challenge } = pkce()
        const cuerpo = {
            iris: IRIS,
            state: nuevoState(),
            code_challenge: challenge,
            code_challenge_method: 'S256',
        }
        const sin = await estado(client.post(`${BASE}/autorizar`).bearerToken(admin).json(cuerpo), 422)
        assert.equal(sin.body().type, 'urn:argosisp:problema:iris_origen_no_confirmado')
        const otro = await estado(
            client
                .post(`${BASE}/autorizar`)
                .bearerToken(admin)
                .json({ ...cuerpo, confirmar_origen: 'otro-iris.example' }),
            422,
        )
        assert.equal(otro.body().type, 'urn:argosisp:problema:iris_origen_no_confirmado')
        assert.lengthOf(await db.from('integraciones.iris_enlaces'), 0)

        const ok = await estado(
            client
                .post(`${BASE}/autorizar`)
                .bearerToken(admin)
                .json({ ...cuerpo, confirmar_origen: ' IRIS.isp.example ' }),
            200,
        )
        assert.isTrue((ok.body().redirigir_a as string).startsWith(`${IRIS}/administracion/`))

        const vista = await estado(
            client.get(`${BASE}/autorizar/vista-previa`).bearerToken(admin).qs({ iris: IRIS }),
            200,
        )
        assert.isFalse(vista.body().origen_conocido)
    })

    test('422: origen inválido, code_challenge inválido, state corto o con caracteres inseguros; 403 sin permiso', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        process.env.ARGOSISP_IRIS_ORIGENES = IRIS
        const { challenge } = pkce()
        const base = {
            iris: IRIS,
            state: nuevoState(),
            code_challenge: challenge,
            code_challenge_method: 'S256',
        }
        const post = (cuerpo: Record<string, unknown>, status: number) =>
            estado(client.post(`${BASE}/autorizar`).bearerToken(admin).json(cuerpo), status)

        for (const iris of [
            'iris.isp.example',
            'ftp://iris.isp.example',
            'https://iris.isp.example/panel',
            'https://iris.isp.example/?x=1',
            'https://usuario:clave@iris.isp.example',
        ]) {
            const r = await post({ ...base, iris }, 422)
            assert.equal(r.body().type, 'urn:argosisp:problema:iris_origen_invalido', iris)
        }
        for (const codeChallenge of [
            'corto',
            challenge.slice(0, 42),
            `${challenge.slice(0, 42)}+`,
            `${challenge}A`,
        ]) {
            const r = await post({ ...base, code_challenge: codeChallenge }, 422)
            assert.equal(r.body().type, 'urn:argosisp:problema:code_challenge_invalido', codeChallenge)
        }
        await post({ ...base, code_challenge_method: 'plain' }, 422)
        await post({ ...base, state: 'corto' }, 422)
        await post({ ...base, state: 'x'.repeat(257) }, 422)
        await post({ ...base, state: `${'x'.repeat(20)}&api=https://malo` }, 422)
        assert.lengthOf(await db.from('integraciones.iris_enlaces'), 0)

        const vista = await estado(
            client.get(`${BASE}/autorizar/vista-previa`).bearerToken(admin).qs({ iris: 'no es url' }),
            422,
        )
        assert.equal(vista.body().type, 'urn:argosisp:problema:iris_origen_invalido')

        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(client.post(`${BASE}/autorizar`).bearerToken(soporte).json(base), 403)
        await estado(
            client.get(`${BASE}/autorizar/vista-previa`).bearerToken(soporte).qs({ iris: IRIS }),
            403,
        )
    })

    test('canje: verifier incorrecto → 401 y el código queda gastado; faltante → 401', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        process.env.ARGOSISP_IRIS_ORIGENES = IRIS

        const a = await autorizar(client, admin)
        const malo = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(a.codigo, { code_verifier: pkce().verifier })),
            401,
        )
        assert.equal(malo.body().type, 'urn:argosisp:problema:codigo_invalido')
        const fila = await db.from('integraciones.iris_enlaces').firstOrFail()
        assert.isNotNull(fila.rechazado_en)
        assert.isNull(fila.usado_en)
        // gastado: ni con el verifier correcto
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(a.codigo, { code_verifier: a.verifier })),
            410,
        )
        assert.isNull(await db.from('integraciones.iris_conector').where('id', 1).first())

        const b = await autorizar(client, admin)
        const falta = await estado(client.post(`${BASE}/conexion/canjear`).json(canje(b.codigo)), 401)
        assert.equal(falta.body().type, 'urn:argosisp:problema:codigo_invalido')
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(b.codigo, { code_verifier: b.verifier })),
            410,
        )

        // verifier mal formado: 422 de validación
        const c = await autorizar(client, admin)
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(c.codigo, { code_verifier: 'corto' })),
            422,
        )

        // el error queda auditado
        const errores = await db
            .from('audit.acciones')
            .where('accion', 'iris.canjear_enlace')
            .where('resultado', 'error')
        assert.isAtLeast(errores.length, 2)
        assert.notInclude(JSON.stringify(errores), a.verifier)
    })

    test('enlace de §1.3 sin verifier sigue funcionando y responde panel_url; un código nuevo anula el anterior', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        process.env.ARGOSISP_IRIS_ORIGENES = IRIS

        // un código de §1.4 queda anulado al generar el enlace de §1.3
        const a = await autorizar(client, admin)
        const enlace = await estado(client.post(`${BASE}/enlace`).bearerToken(admin), 201)
        const codigo = (enlace.body().enlace as string).split('#')[1]!
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(a.codigo, { code_verifier: a.verifier })),
            410,
        )

        // y el enlace de §1.3 queda anulado por un nuevo código de §1.4
        const b = await autorizar(client, admin)
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo)), 410)

        // el nuevo enlace de §1.3 se canjea sin verifier
        const enlace2 = await estado(client.post(`${BASE}/enlace`).bearerToken(admin), 201)
        const codigo2 = (enlace2.body().enlace as string).split('#')[1]!
        const r = await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo2)), 200)
        assert.match(r.body().token, /^atk_/)
        assert.equal(r.body().panel_url, PANEL)

        const filas = await db.from('integraciones.iris_enlaces').orderBy('id')
        assert.lengthOf(filas, 4)
        assert.isNotNull(filas[0].anulado_en)
        assert.isNotNull(filas[1].anulado_en)
        assert.isNotNull(filas[2].anulado_en)
        assert.isNotNull(filas[3].usado_en)
        assert.isNull(filas[3].code_challenge)
        assert.exists(b.codigo)
    })

    test('auditoría: iris.autorizar con codigo *** y sin el código ni el verifier', async ({
        client,
        assert,
    }) => {
        const { token: admin, usuario } = await usuarioConRoles(['admin'])
        process.env.ARGOSISP_IRIS_ORIGENES = IRIS
        await autorizar(client, admin)
        const a = await autorizar(client, admin)
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(a.codigo, { code_verifier: a.verifier })),
            200,
        )

        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'iris.autorizar')
            .where('actor_id', usuario.id)
            .orderBy('id')
        assert.lengthOf(acciones, 2)
        const ultima = acciones[1]
        assert.equal(ultima.resultado, 'ok')
        assert.equal(Number(ultima.actor_id), usuario.id)
        assert.equal(ultima.entidad_tipo, 'enlace_iris')
        const entrada = typeof ultima.entrada === 'string' ? JSON.parse(ultima.entrada) : ultima.entrada
        assert.equal(entrada.auditoria.codigo, '***')
        assert.equal(entrada.auditoria.origen_iris, IRIS)
        assert.isTrue(entrada.auditoria.origen_conocido)
        assert.lengthOf(entrada.auditoria.enlaces_anulados, 1)
        assert.equal(entrada.iris, IRIS)

        const todo = JSON.stringify(
            await db.from('audit.acciones').whereIn('accion', ['iris.autorizar', 'iris.canjear_enlace']),
        )
        assert.notInclude(todo, a.codigo)
        assert.notInclude(todo, a.verifier)
        assert.notInclude(todo, TOKEN_IRIS)
        // no emite eventos (igual que el enlace de §1.3)
        assert.lengthOf(await db.from('audit.outbox').whereRaw("evento LIKE 'iris.%'"), 0)
    })

    test('vista previa: empresas y alcance iguales a los del canje', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        process.env.ARGOSISP_IRIS_ORIGENES = IRIS
        const vista = await estado(
            client.get(`${BASE}/autorizar/vista-previa`).bearerToken(admin).qs({ iris: IRIS }),
            200,
        )
        assert.equal(vista.body().origen_normalizado, IRIS)
        assert.isTrue(vista.body().origen_conocido)

        const a = await autorizar(client, admin)
        const c = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(a.codigo, { code_verifier: a.verifier })),
            200,
        )
        assert.equal(vista.body().alcance_global, c.body().alcance_global)
        assert.deepEqual(vista.body().empresas, c.body().empresas)
        assert.isNotNull(await usuarioIris())

        const despues = await estado(
            client.get(`${BASE}/autorizar/vista-previa`).bearerToken(admin).qs({ iris: IRIS }),
            200,
        )
        assert.deepEqual(despues.body().empresas, c.body().empresas)
    })
})
