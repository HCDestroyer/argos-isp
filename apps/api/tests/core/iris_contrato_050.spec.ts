import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { usuarioIris } from '#core/integraciones_iris'
import {
    CONTRATO_IRIS,
    compararSemver,
    conectorAdmite,
    contratoAdmite,
} from '#integraciones/iris/configuracion'

/**
 * Contrato Iris 0.5.0, «Versión y compatibilidad» (§3.3):
 * - el canje y `GET /integraciones/iris/estado` devuelven `version_argos` y `contrato`;
 * - el canje acepta `contrato` (la versión que habla Iris) y lo guarda en el conector;
 * - `PUT /integraciones/iris/contrato` lo actualiza con el token de Iris;
 * - `conectorAdmite(version)` para que A6 filtre los webhooks nuevos.
 */

const BASE_IRIS = '/api/v1/integraciones/iris'

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: 'https://iris.isp.example',
        token: `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`,
        webhook: {
            url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
            secreto: 'secreto-del-receptor-de-iris-0123456789',
        },
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function enlace(client: any, admin: string): Promise<string> {
    const r = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
    return (r.body().enlace as string).split('#')[1]!
}

async function contratoGuardado(): Promise<string | null> {
    const fila = await db.from('integraciones.iris_conector').where('id', 1).select('contrato').first()
    return (fila?.contrato as string | null | undefined) ?? null
}

test.group('Iris 0.5.0 · versión de Argos y contrato del conector', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = 'https://argos.isp.example'
        process.env.ARGOSISP_VERSION = '1.6.0'
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            delete process.env.ARGOSISP_VERSION
            await soloEmpresaPrincipal()
        }
    })

    test('canje sin contrato: version_argos y contrato de Argos; el conector queda sin contrato', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(await enlace(client, admin))),
            200,
        )
        assert.include(r.body(), { version_argos: '1.6.0', contrato: CONTRATO_IRIS })
        assert.equal(CONTRATO_IRIS, '0.5.0')
        assert.isNull(await contratoGuardado())
        assert.isFalse(await conectorAdmite('0.5.0'))

        const vista = await estado(client.get(BASE_IRIS).bearerToken(admin), 200)
        assert.isNull(vista.body().contrato)
    })

    test('canje con contrato: se guarda (con diff) y conectorAdmite lo respeta; repetición y 422', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await enlace(client, admin)
        const cuerpo = canje(codigo, { contrato: '0.5.0' })
        const r = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
        assert.include(r.body(), { version_argos: '1.6.0', contrato: '0.5.0' })
        assert.equal(await contratoGuardado(), '0.5.0')
        assert.isTrue(await conectorAdmite('0.5.0'))
        assert.isTrue(await conectorAdmite('0.4.0'))
        assert.isFalse(await conectorAdmite('0.6.0'))
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'conector_iris', entidad_id: 1, campo: 'contrato' })
            .orderBy('id', 'desc')
            .first()
        assert.equal(cambio?.despues, '0.5.0')

        // la misma petición repetida recibe la misma respuesta (con la versión actual)
        const repetida = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
        assert.deepEqual(repetida.body(), r.body())
        // otra petición con el código usado (otro contrato): 410
        await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo, { contrato: '0.6.0' })),
            410,
        )

        // contrato que no es semver: 422 de validación
        const malo = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await enlace(client, admin), { contrato: 'v0.5' })),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'contrato')

        // reconectar con un Iris que no informa contrato lo deja en null (no recibe lo nuevo)
        await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(await enlace(client, admin))),
            200,
        )
        assert.isNull(await contratoGuardado())
    })

    test('PUT /integraciones/iris/contrato: solo el token de Iris del canje; 403 a los demás', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(await enlace(client, admin))),
            200,
        )
        const atk = r.body().token as string

        const puesto = await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '0.5.0' }),
            200,
        )
        assert.deepEqual(puesto.body(), { contrato_iris: '0.5.0', version_argos: '1.6.0', contrato: '0.5.0' })
        assert.equal(await contratoGuardado(), '0.5.0')
        assert.isTrue(await conectorAdmite('0.5.0'))
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'iris.informar_contrato')
            .orderBy('id', 'desc')
            .first()
        assert.equal(accion?.resultado, 'ok')

        // una prerelease anterior baja el contrato (Iris dice lo que habla)
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '0.5.0-rc.1' }),
            200,
        )
        assert.isFalse(await conectorAdmite('0.5.0'))

        // el admin tiene sso.emitir, pero no es el token de Iris
        await estado(client.put(`${BASE_IRIS}/contrato`).bearerToken(admin).json({ contrato: '0.5.0' }), 403)
        // otro token del usuario técnico Iris: el conector se preparó con un enlace, solo vale el del canje
        const otro = await estado(
            client.post(`${BASE_IRIS}/tokens`).bearerToken(admin).json({ nombre: 'Iris (a mano)' }),
            201,
        )
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(otro.body().token).json({ contrato: '0.5.0' }),
            403,
        )
        // sin token: 401; formato inválido: 422
        await estado(client.put(`${BASE_IRIS}/contrato`).json({ contrato: '0.5.0' }), 401)
        await estado(client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '5' }), 422)
        assert.equal(await contratoGuardado(), '0.5.0-rc.1')
    })

    test('GET /integraciones/iris/estado: iris.abrir o el token de Iris; versión y contrato', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const delPanel = await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(admin), 200)
        assert.deepEqual(delPanel.body(), { activo: false, version_argos: '1.6.0', contrato: '0.5.0' })

        const r = await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(await enlace(client, admin))),
            200,
        )
        const deIris = await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(r.body().token), 200)
        assert.deepEqual(deIris.body(), { activo: false, version_argos: '1.6.0', contrato: '0.5.0' })

        const { token: lectura } = await usuarioConRoles(['lectura'])
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(lectura), 403)

        // fuera de una imagen publicada la versión es `desarrollo`
        delete process.env.ARGOSISP_VERSION
        const desarrollo = await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(admin), 200)
        assert.equal(desarrollo.body().version_argos, 'desarrollo')
        assert.isNotNull(await usuarioIris())
    })
})

test.group('Iris 0.5.0 · comparar versiones del contrato', () => {
    test('compararSemver y contratoAdmite', ({ assert }) => {
        assert.equal(compararSemver('0.5.0', '0.5.0'), 0)
        assert.isAbove(compararSemver('0.10.0', '0.9.9')!, 0)
        assert.isBelow(compararSemver('0.5.0-rc.1', '0.5.0')!, 0)
        assert.isBelow(compararSemver('0.5.0-rc.1', '0.5.0-rc.2')!, 0)
        assert.isBelow(compararSemver('0.5.0-1', '0.5.0-alpha')!, 0)
        assert.isAbove(compararSemver('1.0.0', '0.99.0')!, 0)
        assert.isNull(compararSemver('v0.5.0', '0.5.0'))
        assert.isTrue(contratoAdmite('0.5.0', '0.5.0'))
        assert.isTrue(contratoAdmite('0.5.1', '0.5.0'))
        assert.isFalse(contratoAdmite('0.4.9', '0.5.0'))
        assert.isFalse(contratoAdmite(null, '0.5.0'))
        assert.isFalse(contratoAdmite('cualquiera', '0.5.0'))
    })
})
