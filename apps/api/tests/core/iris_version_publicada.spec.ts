import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { CONTRATO_IRIS, compararSemver } from '#integraciones/iris/configuracion'

/**
 * Regresión del aviso «Argos < 1.6.0: inventario por técnico no disponible» que Iris mostraba con
 * Argos 1.14.0 (A6, 9 nov). Reproduce la secuencia exacta del job de Iris
 * (`integracion.argos_informar_contrato`): `PUT /integraciones/iris/contrato` y luego
 * `GET /integraciones/iris/estado`, con el `atk_` del canje, y exige que las dos respondan 200 con
 * `version_argos` IGUAL a la versión publicada (`.release-please-manifest.json`, la misma que el
 * workflow `imagenes.yml` pone en `ARGOSISP_VERSION`). Iris borra la versión con un 404/405 y la
 * deja sin actualizar con cualquier otro error, así que también cubre:
 * - la reconexión sin corte del contrato 0.6.3 (el primer uso del `atk_` nuevo es el PUT);
 * - `X-Empresa-Id` de la empresa del conector (Iris la manda en otras llamadas);
 * - el `atk_` anterior ya revocado (401, nunca 404).
 */

const BASE_IRIS = '/api/v1/integraciones/iris'

async function versionPublicada(): Promise<string> {
    const manifiesto = JSON.parse(
        await readFile(app.makePath('..', '..', '.release-please-manifest.json'), 'utf8'),
    ) as Record<string, string>
    return manifiesto['.']!
}

function canje(codigo: string, n: number) {
    return {
        codigo,
        sistema: 'iris',
        base_url: 'https://iris.isp.example',
        token: `iris_pat_${'Zx9Yw8Vu'.repeat(5)}${n}`,
        webhook: {
            url: `https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-${n}`,
            secreto: `secreto-del-receptor-de-iris-0123456789-${n}`,
        },
        contrato: CONTRATO_IRIS,
        receptor_argos: true,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function canjear(client: any, admin: string, n: number) {
    const e = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
    const codigo = (e.body().enlace as string).split('#')[1]!
    return estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo, n)), 200)
}

/** Lo que hace el job de Iris: PUT …/contrato y GET …/estado con el mismo token. */
async function leerComoIris(client: any, atk: string, cabeceras: Record<string, string> = {}) {
    const puesto = await estado(
        client
            .put(`${BASE_IRIS}/contrato`)
            .headers(cabeceras)
            .bearerToken(atk)
            .json({ contrato: CONTRATO_IRIS }),
        200,
    )
    const leido = await estado(client.get(`${BASE_IRIS}/estado`).headers(cabeceras).bearerToken(atk), 200)
    return { puesto: puesto.body(), leido: leido.body() }
}

test.group('Iris · version_argos es la versión publicada', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = 'https://argos.isp.example'
        process.env.ARGOSISP_VERSION = await versionPublicada()
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            delete process.env.ARGOSISP_VERSION
            await soloEmpresaPrincipal()
        }
    })

    test('la versión publicada es semver ≥ 1.6.0 (la que Iris exige para el inventario por técnico)', async ({
        assert,
    }) => {
        const version = await versionPublicada()
        assert.match(version, /^\d+\.\d+\.\d+$/)
        assert.isAtLeast(compararSemver(version, '1.6.0') ?? -1, 0)
    })

    test('canje, PUT …/contrato y GET …/estado con el atk_ del canje responden la versión publicada', async ({
        client,
        assert,
    }) => {
        const version = await versionPublicada()
        const { token: admin } = await usuarioConRoles(['admin'])
        const r = await canjear(client, admin, 1)
        assert.equal(r.body().version_argos, version)
        const empresa = String(r.body().empresas[0].id)

        const sinEmpresa = await leerComoIris(client, r.body().token)
        assert.deepEqual(sinEmpresa.puesto, {
            contrato_iris: CONTRATO_IRIS,
            version_argos: version,
            contrato: CONTRATO_IRIS,
        })
        assert.equal(sinEmpresa.leido.version_argos, version)

        const conEmpresa = await leerComoIris(client, r.body().token, { 'X-Empresa-Id': empresa })
        assert.equal(conEmpresa.puesto.version_argos, version)
        assert.equal(conEmpresa.leido.version_argos, version)
    })

    test('reconexión sin corte (0.6.3): el atk_ nuevo lee la versión en su primer uso; el anterior da 401', async ({
        client,
        assert,
    }) => {
        const version = await versionPublicada()
        const { token: admin } = await usuarioConRoles(['admin'])
        const primero = await canjear(client, admin, 1)
        await leerComoIris(client, primero.body().token)

        // conector en uso: encendido (la reconexión queda pendiente hasta el primer uso del atk_ nuevo)
        const vista = await estado(client.get(BASE_IRIS).bearerToken(admin), 200)
        await estado(
            client.put(BASE_IRIS).bearerToken(admin).json({ activo: true, version: vista.body().version }),
            200,
        )

        const segundo = await canjear(client, admin, 2)
        assert.equal(segundo.body().version_argos, version)
        const leido = await leerComoIris(client, segundo.body().token)
        assert.equal(leido.puesto.version_argos, version)
        assert.deepEqual(leido.leido, { activo: true, version_argos: version, contrato: CONTRATO_IRIS })

        await estado(
            client
                .put(`${BASE_IRIS}/contrato`)
                .bearerToken(primero.body().token)
                .json({ contrato: CONTRATO_IRIS }),
            401,
        )
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(primero.body().token), 401)
    })
})
