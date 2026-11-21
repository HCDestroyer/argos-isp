import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { descifrar } from '#shared/cifrado'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'

/**
 * Contrato Iris 0.9.0 §1.2: el `token_portal` llega en el canje y en `PUT /integraciones/iris/contrato`;
 * Argos lo guarda cifrado en `integraciones.iris_conector.token_portal_cifrado` (lo lee A5), nunca lo
 * devuelve y en la auditoría queda como `***`. Se rota con cada canje y se borra al desconectar.
 */

const BASE_IRIS = '/api/v1/integraciones/iris'
const IRIS = 'https://iris.isp.example'
const TOKEN = `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`
const PORTAL = `iris_pat_${'Pq7Rs6Tu'.repeat(5)}`
const PORTAL_2 = `iris_pat_${'Ab3Cd4Ef'.repeat(5)}`

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: IRIS,
        token: TOKEN,
        webhook: {
            url: `${IRIS}/api/v1/integraciones/argosisp/webhook/c-1`,
            secreto: 'secreto-del-receptor-de-iris-0123456789',
        },
        contrato: '0.9.0',
        receptor_argos: true,
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function codigoNuevo(client: any, admin: string): Promise<string> {
    const r = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
    return (r.body().enlace as string).split('#')[1]!
}

async function tokenPortalGuardado(): Promise<string | null> {
    const fila = await db
        .from('integraciones.iris_conector')
        .where('id', 1)
        .select('token_portal_cifrado')
        .first()
    const cifrado = fila?.token_portal_cifrado as string | null | undefined
    return cifrado ? descifrar(cifrado) : null
}

test.group('Iris 0.9.0 · token_portal', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = 'https://api.argos.isp.example'
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            await soloEmpresaPrincipal()
        }
    })

    test('canje: se guarda cifrado, nunca sale en respuestas y se audita como ***', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { token_portal: PORTAL })),
            200,
        )
        assert.notInclude(JSON.stringify(r.body()), PORTAL)
        assert.equal(await tokenPortalGuardado(), PORTAL)
        const fila = await db.from('integraciones.iris_conector').where('id', 1).first()
        assert.notInclude(fila.token_portal_cifrado, PORTAL)

        const vista = await estado(client.get(BASE_IRIS).bearerToken(admin), 200)
        assert.equal(vista.body().token_portal, '***')
        assert.notInclude(JSON.stringify(vista.body()), PORTAL)

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'conector_iris', campo: 'token_portal_cifrado' })
            .orderBy('id', 'desc')
            .first()
        assert.equal(cambios.despues, '***')
        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'iris.canjear_enlace')
            .orderBy('id', 'desc')
            .first()
        assert.notInclude(JSON.stringify(acciones?.entrada ?? {}), PORTAL)
    })

    test('canje: formato iris_pat_ y distinto del token del panel; sin token_portal queda null', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const malo = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { token_portal: 'no-es-un-pat' })),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'token_portal')
        assert.notInclude(JSON.stringify(malo.body()), 'no-es-un-pat')
        await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { token_portal: TOKEN })),
            422,
        )
        await estado(
            client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(await codigoNuevo(client, admin))),
            200,
        )
        assert.isNull(await tokenPortalGuardado())
    })

    test('PUT /contrato: lo guarda con contrato ≥ 0.9.0, lo ignora con uno anterior y null lo borra', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const canjeado = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { contrato: '0.8.1' })),
            200,
        )
        const atk = canjeado.body().token as string
        const poner = (cuerpo: Record<string, unknown>) =>
            client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json(cuerpo)

        await estado(poner({ contrato: '0.8.1', token_portal: PORTAL }), 200)
        assert.isNull(await tokenPortalGuardado(), 'con un contrato anterior a 0.9.0 se ignora')

        const r = await estado(poner({ contrato: '0.9.0', token_portal: PORTAL }), 200)
        assert.notInclude(JSON.stringify(r.body()), PORTAL)
        assert.equal(await tokenPortalGuardado(), PORTAL)

        await estado(poner({ contrato: '0.9.0' }), 200)
        assert.equal(await tokenPortalGuardado(), PORTAL, 'omitido se conserva')

        await estado(poner({ contrato: '0.9.0', token_portal: PORTAL_2 }), 200)
        assert.equal(await tokenPortalGuardado(), PORTAL_2)

        const malo = await estado(poner({ contrato: '0.9.0', token_portal: 'x'.repeat(20) }), 422)
        assert.equal(malo.body().errors[0].field, 'token_portal')

        await estado(poner({ contrato: '0.9.0', token_portal: null }), 200)
        assert.isNull(await tokenPortalGuardado())

        const acciones = await db.from('audit.acciones').where('accion', 'iris.informar_contrato')
        assert.notInclude(JSON.stringify(acciones.map((a) => a.entrada)), PORTAL_2)
        assert.notInclude(JSON.stringify(acciones.map((a) => a.entrada)), PORTAL)
    })

    test('reconexión: el canje nuevo rota el token_portal al confirmarse; desconectar lo borra', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const primero = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { token_portal: PORTAL })),
            200,
        )
        // primera llamada del atk_ confirma el canje
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(primero.body().token).json({ contrato: '0.9.0' }),
            200,
        )
        const segundo = await estado(
            client
                .post(`${BASE_IRIS}/conexion/canjear`)
                .json(canje(await codigoNuevo(client, admin), { token_portal: PORTAL_2 })),
            200,
        )
        assert.equal(await tokenPortalGuardado(), PORTAL, 'la reconexión queda pendiente')
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(segundo.body().token).json({ contrato: '0.9.0' }),
            200,
        )
        assert.equal(await tokenPortalGuardado(), PORTAL_2)

        // Iris revoca su atk_: el conector queda desconectado y sin el token_portal
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(segundo.body().token), 204)
        assert.isNull(await tokenPortalGuardado())
    })
})
