import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearRouterFila, crearZonaFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { EMAIL_USUARIO_IRIS, ROL_IRIS, usuarioIris } from '#core/integraciones_iris'

/**
 * El usuario técnico Iris solo tiene alcance por empresas (o global), nunca por zona ni router
 * (revisión de seguridad de Iris, contrato Iris 0.3.1 §1): con un alcance de red, un cliente con
 * servicios fuera de él aparecería en Iris sin servicios aunque se pida `?empresas=todas`.
 */

const TIPO = 'urn:argosisp:problema:usuario_tecnico_solo_empresas'
const BASE_IRIS = '/api/v1/integraciones/iris'

/** Borra los roles del usuario Iris que dejó cada prueba (vuelve a «sin alcance de red»). */
async function limpiarRolesIris() {
    const id = await usuarioIris()
    if (id === null) return
    const rol = await db.from('core.roles').where('nombre', ROL_IRIS).select('id').firstOrFail()
    await db.from('core.usuarios_roles').where('usuario_id', id).delete()
    await db.table('core.usuarios_roles').insert({ usuario_id: id, role_id: rol.id })
}

async function asegurarIris(): Promise<number> {
    await new GenerarTokenIris().execute({}, contextoPrueba())
    return (await usuarioIris())!
}

async function rolIrisId(): Promise<number> {
    const rol = await db.from('core.roles').where('nombre', ROL_IRIS).select('id').firstOrFail()
    return Number(rol.id)
}

test.group('Iris 0.3.1 · usuario técnico solo con alcance por empresas', (group) => {
    group.each.setup(async () => {
        await limpiarRolesIris()
        return limpiarRolesIris
    })

    test('POST /integraciones/iris/tokens con routers o zonas → 422; sin ellos → 201 sin alcance de red', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila()
        const zonaId = await crearZonaFila()
        const r = await estado(
            client
                .post(`${BASE_IRIS}/tokens`)
                .bearerToken(admin)
                .json({ routers: [routerId] }),
            422,
        )
        assert.equal(r.body().type, TIPO)
        assert.equal(r.body().errors[0].field, 'alcances.routers')
        const z = await estado(
            client
                .post(`${BASE_IRIS}/tokens`)
                .bearerToken(admin)
                .json({ zonas: [zonaId] }),
            422,
        )
        assert.equal(z.body().type, TIPO)
        assert.equal(z.body().errors[0].field, 'alcances.zonas')

        const ok = await estado(client.post(`${BASE_IRIS}/tokens`).bearerToken(admin).json({}), 201)
        assert.notProperty(ok.body().datos.alcances, 'routers')
        assert.notProperty(ok.body().datos.alcances, 'zonas')
        // listas vacías no restringen nada: se aceptan
        await estado(
            client.post(`${BASE_IRIS}/tokens`).bearerToken(admin).json({ routers: [], zonas: [] }),
            201,
        )
    })

    test('POST /tokens genérico para el usuario Iris con routers o zonas → 422; a otro usuario sí se le permite', async ({
        client,
        assert,
    }) => {
        const iris = await asegurarIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const zonaId = await crearZonaFila()
        const r = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({ usuario_id: iris, nombre: 'Iris acotado', alcances: { zonas: [zonaId] } }),
            422,
        )
        assert.equal(r.body().type, TIPO)
        const antes = await db.from('core.tokens_api').where('usuario_id', iris).count('* as n').first()
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({ usuario_id: iris, nombre: 'Iris lectura', alcances: { permisos: ['clientes.ver'] } }),
            201,
        )
        const despues = await db.from('core.tokens_api').where('usuario_id', iris).count('* as n').first()
        assert.equal(Number(despues.n), Number(antes.n) + 1)

        const otro = await usuarioConRoles(['soporte'])
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({ usuario_id: otro.usuario.id, nombre: 'Zona', alcances: { zonas: [zonaId] } }),
            201,
        )
    })

    test('editar el usuario Iris con roles por zona o router → 422; sin alcance, sí', async ({
        client,
        assert,
    }) => {
        const iris = await asegurarIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const rol = await rolIrisId()
        const zonaId = await crearZonaFila()
        const routerId = await crearRouterFila()
        const usuario = await db.from('core.usuarios').where('id', iris).firstOrFail()
        for (const asignacion of [
            { role_id: rol, alcance_tipo: 'zona', alcance_id: zonaId },
            { role_id: rol, alcance_tipo: 'router', alcance_id: routerId },
        ]) {
            const r = await estado(
                client
                    .put(`/api/v1/usuarios/${iris}`)
                    .bearerToken(admin)
                    .json({ version: usuario.version, roles: [asignacion] }),
                422,
            )
            assert.equal(r.body().type, TIPO)
            assert.equal(r.body().errors[0].field, 'roles.0.alcance_tipo')
        }
        const filas = await db.from('core.usuarios_roles').where('usuario_id', iris)
        assert.isTrue(filas.every((f) => f.alcance_tipo === null))

        await estado(
            client
                .put(`/api/v1/usuarios/${iris}`)
                .bearerToken(admin)
                .json({ version: usuario.version, roles: [{ role_id: rol }] }),
            200,
        )
    })

    test('un usuario con roles de red no puede tomar el correo del usuario Iris', async ({
        client,
        assert,
    }) => {
        // sin usuario Iris aún: libera el correo para la prueba y lo restaura al final
        const iris = await usuarioIris()
        if (iris !== null) {
            await db
                .from('core.usuarios')
                .where('id', iris)
                .update({ email: `iris-${unico('x')}@aparte.local` })
        }
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const zonaId = await crearZonaFila()
            const soporte = await db.from('core.roles').where('nombre', 'soporte').select('id').firstOrFail()
            const rol = Number(soporte.id)

            // alta directa con el correo de Iris y un rol por zona
            const alta = await estado(
                client
                    .post('/api/v1/usuarios')
                    .bearerToken(admin)
                    .json({
                        nombre: 'Iris falso',
                        email: EMAIL_USUARIO_IRIS,
                        password: 'clave-larga-123',
                        roles: [{ role_id: rol, alcance_tipo: 'zona', alcance_id: zonaId }],
                    }),
                422,
            )
            assert.equal(alta.body().type, TIPO)
            assert.isNull(await usuarioIris())

            // un usuario con rol por zona que se renombra al correo de Iris
            const creado = await estado(
                client
                    .post('/api/v1/usuarios')
                    .bearerToken(admin)
                    .json({
                        nombre: 'Técnico zona',
                        email: `${unico('tz')}@ejemplo.gt`,
                        password: 'clave-larga-123',
                        roles: [{ role_id: rol, alcance_tipo: 'zona', alcance_id: zonaId }],
                    }),
                201,
            )
            const cambio = await estado(
                client
                    .put(`/api/v1/usuarios/${creado.body().id}`)
                    .bearerToken(admin)
                    .json({ version: creado.body().version, email: EMAIL_USUARIO_IRIS }),
                422,
            )
            assert.equal(cambio.body().type, TIPO)
            assert.isNull(await usuarioIris())
        } finally {
            if (iris !== null) {
                await db.from('core.usuarios').where('id', iris).update({ email: EMAIL_USUARIO_IRIS })
            }
        }
    })

    test('datos viejos: con un rol por zona en la base, ni el canje ni GenerarTokenIris emiten token', async ({
        client,
        assert,
    }) => {
        const iris = await asegurarIris()
        const zonaId = await crearZonaFila()
        await db.table('core.usuarios_roles').insert({
            usuario_id: iris,
            role_id: await rolIrisId(),
            alcance_tipo: 'zona',
            alcance_id: zonaId,
        })
        const { token: admin } = await usuarioConRoles(['admin'])
        const r = await estado(client.post(`${BASE_IRIS}/tokens`).bearerToken(admin).json({}), 422)
        assert.equal(r.body().type, TIPO)
        assert.equal(r.body().errors[0].field, 'roles')

        process.env.API_PUBLIC_URL = 'https://argos.isp.example'
        try {
            await db.from('integraciones.iris_enlaces').delete()
            const generado = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
            const codigo = (generado.body().enlace as string).split('#')[1]!
            const tokensAntes = await db
                .from('core.tokens_api')
                .where('usuario_id', iris)
                .count('* as n')
                .first()
            const canje = await estado(
                client.post(`${BASE_IRIS}/conexion/canjear`).json({
                    codigo,
                    sistema: 'iris',
                    base_url: 'https://iris.isp.example',
                    token: `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`,
                    webhook: {
                        url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
                        secreto: 'secreto-del-receptor-de-iris-0123456789',
                    },
                }),
                422,
            )
            assert.equal(canje.body().type, TIPO)
            const tokensDespues = await db
                .from('core.tokens_api')
                .where('usuario_id', iris)
                .count('* as n')
                .first()
            assert.equal(Number(tokensDespues.n), Number(tokensAntes.n))
            // el enlace no se consumió: se puede canjear tras quitar el rol
            const enlace = await db.from('integraciones.iris_enlaces').firstOrFail()
            assert.isNull(enlace.usado_en)
        } finally {
            await db.from('integraciones.iris_enlaces').delete()
            await db.from('integraciones.iris_conector').delete()
            delete process.env.API_PUBLIC_URL
        }
    })
})
