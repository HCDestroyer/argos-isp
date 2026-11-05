import { test } from '@japa/runner'
import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { MOTIVO_RECONECTAR_RECEPTOR, RUTA_RECEPTOR_IRIS } from '#integraciones/iris/configuracion'

/**
 * Contrato Iris 0.6.2, `receptor_argos` (iris#104):
 * - el canje y `PUT /integraciones/iris/contrato` aceptan `receptor_argos` (boolean, opcional) y lo
 *   guardan en `integraciones.iris_conector.receptor_argos`; un Iris viejo que no lo manda no rompe nada;
 * - `GET /integraciones/iris` responde `requiere_reconectar` y `motivo_reconectar`: true solo si el
 *   último informado es false;
 * - la URL del receptor que entrega el canje tiene el mismo origen que la base de Argos que Iris
 *   recibe (el enlace de §1.3 o `api=` de §1.4).
 */

const BASE_IRIS = '/api/v1/integraciones/iris'
const IRIS = 'https://iris.isp.example'
const ARGOS = 'https://api.argos.isp.example'
const PANEL = 'https://panel.argos.isp.example'

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: IRIS,
        token: `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`,
        webhook: {
            url: `${IRIS}/api/v1/integraciones/argosisp/webhook/c-1`,
            secreto: 'secreto-del-receptor-de-iris-0123456789',
        },
        contrato: '0.6.2',
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

/** Código de un enlace nuevo. */
async function codigoNuevo(client: any, admin: string): Promise<string> {
    const { codigo } = await enlace(client, admin)
    return codigo
}

/** Si el conector pide volver a conectar. */
async function pideReconectar(client: any, admin: string): Promise<boolean> {
    const v = await vista(client, admin)
    return v.requiere_reconectar as boolean
}

async function enlace(client: any, admin: string): Promise<{ codigo: string; base: string }> {
    const r = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
    const [url, codigo] = (r.body().enlace as string).split('#') as [string, string]
    return { codigo, base: url.replace(/\/conectar$/, '') }
}

async function receptorGuardado(): Promise<boolean | null | undefined> {
    const fila = await db.from('integraciones.iris_conector').where('id', 1).select('receptor_argos').first()
    return fila?.receptor_argos as boolean | null | undefined
}

async function vista(client: any, admin: string) {
    const r = await estado(client.get(BASE_IRIS).bearerToken(admin), 200)
    return r.body()
}

test.group('Iris 0.6.2 · receptor_argos y requiere_reconectar', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        process.env.PANEL_URL_PUBLICA = PANEL
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            delete process.env.PANEL_URL_PUBLICA
            await soloEmpresaPrincipal()
        }
    })

    test('sin conector: requiere_reconectar false y motivo null', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const v = await vista(client, admin)
        assert.isFalse(v.requiere_reconectar)
        assert.isNull(v.motivo_reconectar)
    })

    test('canje con receptor_argos true: se guarda con diff; repetición igual; GET sin aviso', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { codigo } = await enlace(client, admin)
        const cuerpo = canje(codigo, { receptor_argos: true })
        const r = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
        assert.isTrue(await receptorGuardado())
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'conector_iris', entidad_id: 1, campo: 'receptor_argos' })
            .orderBy('id', 'desc')
            .first()
        assert.equal(String(cambio?.despues), 'true')

        const repetida = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
        assert.deepEqual(repetida.body(), r.body())
        // con el código usado, otra petición (sin receptor_argos) es otra: 410
        await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo, { receptor_argos: false })),
            410,
        )

        const v = await vista(client, admin)
        assert.isFalse(v.requiere_reconectar)
        assert.isNull(v.motivo_reconectar)

        // no booleano: 422 en el campo
        const malo = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { receptor_argos: 'si' })),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'receptor_argos')
    })

    test('canje de un Iris viejo (sin receptor_argos ni contrato): null, sin aviso', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const cuerpo = canje(await codigoNuevo(client, admin))
        delete (cuerpo as Record<string, unknown>).contrato
        await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
        assert.isNull(await receptorGuardado())
        const v = await vista(client, admin)
        assert.isFalse(v.requiere_reconectar)
        assert.isNull(v.motivo_reconectar)
    })

    test('PUT contrato con receptor_argos false: aviso; omitido se conserva; true lo quita; reconectar', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        // conector canjeado antes de B1: sin receptor_argos
        const cuerpo = canje(await codigoNuevo(client, admin), { contrato: '0.5.0' })
        const r = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
        const atk = r.body().token as string

        const puesto = await estado(
            client
                .put(`${BASE_IRIS}/contrato`)
                .bearerToken(atk)
                .json({ contrato: '0.6.2', receptor_argos: false }),
            200,
        )
        assert.equal(puesto.body().contrato_iris, '0.6.2')
        assert.isFalse(await receptorGuardado())
        let v = await vista(client, admin)
        assert.isTrue(v.requiere_reconectar)
        assert.equal(v.motivo_reconectar, MOTIVO_RECONECTAR_RECEPTOR)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'conector_iris', entidad_id: 1, campo: 'receptor_argos' })
            .orderBy('id', 'desc')
            .first()
        assert.equal(String(cambio?.despues), 'false')

        // un PUT sin receptor_argos (un Iris que solo informa el contrato) lo conserva
        await estado(client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '0.6.2' }), 200)
        assert.isFalse(await receptorGuardado())
        v = await vista(client, admin)
        assert.isTrue(v.requiere_reconectar)

        // no booleano: 422
        await estado(
            client
                .put(`${BASE_IRIS}/contrato`)
                .bearerToken(atk)
                .json({ contrato: '0.6.2', receptor_argos: 'no' }),
            422,
        )

        // true lo quita
        await estado(
            client
                .put(`${BASE_IRIS}/contrato`)
                .bearerToken(atk)
                .json({ contrato: '0.6.2', receptor_argos: true }),
            200,
        )
        assert.isTrue(await receptorGuardado())
        v = await vista(client, admin)
        assert.isFalse(v.requiere_reconectar)
        assert.isNull(v.motivo_reconectar)

        // vuelve a false y se reconecta con B1: el canje deja true y el aviso desaparece
        await estado(
            client
                .put(`${BASE_IRIS}/contrato`)
                .bearerToken(atk)
                .json({ contrato: '0.6.2', receptor_argos: false }),
            200,
        )
        assert.isTrue(await pideReconectar(client, admin))
        await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { receptor_argos: true })),
            200,
        )
        assert.isFalse(await pideReconectar(client, admin))
    })
})

test.group('Iris 0.6.2 · el receptor del canje está en la base de Argos que recibe Iris', (group) => {
    group.each.setup(async () => {
        process.env.PANEL_URL_PUBLICA = PANEL
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            delete process.env.PANEL_URL_PUBLICA
            delete process.env.IRIS_PERMITIR_HTTP
            await soloEmpresaPrincipal()
        }
    })

    test('enlace (§1.3) con API_PUBLIC_URL: mismo origen que el enlace, distinto del panel', async ({
        client,
        assert,
    }) => {
        process.env.API_PUBLIC_URL = `${ARGOS}/api/v1/`
        const { token: admin } = await usuarioConRoles(['admin'])
        const { codigo, base } = await enlace(client, admin)
        assert.equal(base, ARGOS)
        const r = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo)), 200)
        assert.equal(r.body().webhook.url, `${ARGOS}${RUTA_RECEPTOR_IRIS}`)
        assert.equal(new URL(r.body().webhook.url).host, new URL(base).host)
        assert.notEqual(new URL(r.body().webhook.url).host, new URL(r.body().panel_url).host)
    })

    test('enlace (§1.3) sin API_PUBLIC_URL: el host de la petición, igual en enlace y receptor', async ({
        client,
        assert,
    }) => {
        delete process.env.API_PUBLIC_URL
        const { token: admin } = await usuarioConRoles(['admin'])
        // la petición de prueba llega por http://: sin IRIS_PERMITIR_HTTP el enlace responde 422 (un
        // Argos sin API_PUBLIC_URL detrás de un proxy TLS ve http:// y tampoco puede generarlo)
        await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 422)
        process.env.IRIS_PERMITIR_HTTP = 'true'
        const { codigo, base } = await enlace(client, admin)
        const r = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo)), 200)
        assert.equal(r.body().webhook.url, `${base}${RUTA_RECEPTOR_IRIS}`)
        assert.equal(new URL(r.body().webhook.url).host, new URL(base).host)
    })

    test('conectar con un botón (§1.4): mismo origen que api= del fragmento', async ({ client, assert }) => {
        process.env.API_PUBLIC_URL = ARGOS
        const { token: admin } = await usuarioConRoles(['admin'])
        const verifier = randomBytes(32).toString('base64url')
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        const a = await estado(
            client
                .post(`${BASE_IRIS}/autorizar`)
                .bearerToken(admin)
                .json({
                    iris: IRIS,
                    state: randomBytes(32).toString('base64url'),
                    code_challenge: challenge,
                    code_challenge_method: 'S256',
                    confirmar_origen: 'iris.isp.example',
                }),
            200,
        )
        const f = new URLSearchParams((a.body().redirigir_a as string).split('#')[1] ?? '')
        const api = f.get('api')!
        assert.equal(api, ARGOS)
        const r = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(f.get('codigo')!, { code_verifier: verifier, receptor_argos: true })),
            200,
        )
        assert.equal(new URL(r.body().webhook.url).origin, new URL(api).origin)
        assert.isTrue(await receptorGuardado())
    })
})
