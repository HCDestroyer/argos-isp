import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { usuarioIris } from '#core/integraciones_iris'

/**
 * El canje del enlace de conexión de Iris informa las empresas del alcance del token: `id`,
 * `nombre` y `nit`, más `alcance_global` (contrato Iris 0.3.1, §1.3).
 */

const BASE_IRIS = '/api/v1/integraciones/iris'

function canje(codigo: string) {
    return {
        codigo,
        sistema: 'iris',
        base_url: 'https://iris.isp.example',
        token: `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`,
        webhook: {
            url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
            secreto: 'secreto-del-receptor-de-iris-0123456789',
        },
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

test.group('Iris 0.3.1 · empresas del alcance en el canje del enlace', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = 'https://argos.isp.example'
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            const usuario = await usuarioIris()
            if (usuario !== null) {
                await db.from('core.usuarios_empresas').where('usuario_id', usuario).delete()
                await db.from('core.usuarios').where('id', usuario).update({ alcance_global: true })
            }
            await soloEmpresaPrincipal()
        }
    })

    test('alcance global: todas las empresas activas con id, nombre y NIT; acotado: solo las suyas', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const segunda = await crearEmpresaFila({ nit: null })
        const inactiva = await crearEmpresaFila({ activa: false })

        const codigo = await enlace(client, admin)
        const r = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo)), 200)
        const cuerpo = r.body()
        assert.isTrue(cuerpo.alcance_global)
        const esperadas = await db
            .from('core.empresas')
            .where('activa', true)
            .orderBy('id')
            .select('id', 'nombre_comercial as nombre', 'nit')
        assert.deepEqual(
            cuerpo.empresas,
            esperadas.map((e) => ({ id: Number(e.id), nombre: e.nombre, nit: e.nit })),
        )
        const ids = (cuerpo.empresas as Array<{ id: number }>).map((e) => e.id)
        assert.include(ids, 1)
        assert.include(ids, segunda)
        assert.notInclude(ids, inactiva)
        assert.isNull(
            (cuerpo.empresas as Array<{ id: number; nit: string | null }>).find((e) => e.id === segunda)!.nit,
        )

        // la misma petición repetida: la misma respuesta, empresas incluidas
        const repetida = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo)), 200)
        assert.deepEqual(repetida.body(), cuerpo)

        // un administrador acota al usuario Iris a una empresa: el canje siguiente solo la informa
        const usuario = (await usuarioIris())!
        await db.from('core.usuarios').where('id', usuario).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: usuario, empresa_id: segunda })
        const codigo2 = await enlace(client, admin)
        const acotado = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo2)), 200)
        assert.isFalse(acotado.body().alcance_global)
        const empresa = await db.from('core.empresas').where('id', segunda).firstOrFail()
        assert.deepEqual(acotado.body().empresas, [
            { id: segunda, nombre: empresa.nombre_comercial, nit: null },
        ])
    })

    test('un canje guardado antes de 0.3.1 se repite con las empresas del alcance actual', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await enlace(client, admin)
        const primero = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo)), 200)
        const { empresas, alcance_global: global, ...viejo } = primero.body()
        await db
            .from('integraciones.iris_enlaces')
            .whereNotNull('usado_en')
            .update({ respuesta_cifrada: cifrar(JSON.stringify(viejo)) })
        const repetida = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(canje(codigo)), 200)
        assert.deepEqual(repetida.body(), { ...viejo, alcance_global: global, empresas })
    })
})
