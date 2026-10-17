import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import AsignarEmpresasUsuario from '#core/actions/asignar_empresas_usuario'
import CrearUsuario from '#core/actions/crear_usuario'

/**
 * Multiempresa, paso 3: alcance de los usuarios por empresa (`alcance_global`,
 * `core.usuarios_empresas`) y `GET /me` con `empresas[]` y `alcance_global`.
 */

test.group('Multiempresa: alcance de usuarios', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('los usuarios existentes quedan con alcance global; /me trae sus empresas', async ({
        client,
        assert,
    }) => {
        const admin = await db.from('core.usuarios').where('email', 'admin@argosisp.local').firstOrFail()
        assert.isTrue(admin.alcance_global)

        const { token } = await usuarioConRoles(['lectura'])
        const me = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        assert.isTrue(me.body().alcance_global)
        assert.deepEqual(
            me.body().empresas.map((e: { id: number }) => e.id),
            [1],
        )
        assert.properties(me.body().empresas[0], ['id', 'nombre_comercial', 'nit', 'logo_url'])
    })

    test('asignar empresas: lista, diff, /me acotado; global vuelve a verlas todas', async ({
        client,
        assert,
    }) => {
        const norte = await crearEmpresaFila()
        const sur = await crearEmpresaFila()
        const { token: tokenAdmin } = await usuarioConRoles(['admin'])
        const { usuario, token } = await usuarioConRoles(['soporte'])

        const asignado = await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}/empresas`)
                .bearerToken(tokenAdmin)
                .json({ version: 1, alcance_global: false, empresas: [sur, norte, sur] }),
            200,
        )
        assert.include(asignado.body(), { alcance_global: false, version: 2 })
        assert.deepEqual(
            asignado.body().empresas,
            [norte, sur].sort((a, b) => a - b),
        )

        const me = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        assert.isFalse(me.body().alcance_global)
        assert.sameMembers(
            me.body().empresas.map((e: { id: number }) => e.id),
            [norte, sur],
        )

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'usuario', entidad_id: usuario.id })
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['alcance_global', 'empresas'],
        )

        // una empresa desactivada deja de contar
        await db.from('core.empresas').where('id', sur).update({ activa: false })
        const me2 = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        assert.deepEqual(
            me2.body().empresas.map((e: { id: number }) => e.id),
            [norte],
        )

        // versión vieja: 409; sin empresas: 422; empresa inexistente: 422
        await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}/empresas`)
                .bearerToken(tokenAdmin)
                .json({ version: 1, alcance_global: true }),
            409,
        )
        await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}/empresas`)
                .bearerToken(tokenAdmin)
                .json({ version: 2, alcance_global: false, empresas: [] }),
            422,
        )
        const inexistente = await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}/empresas`)
                .bearerToken(tokenAdmin)
                .json({ version: 2, alcance_global: false, empresas: [norte, 999999] }),
            422,
        )
        assert.equal(inexistente.body().errors[0].field, 'empresas.1')

        const global = await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}/empresas`)
                .bearerToken(tokenAdmin)
                .json({ version: 2, alcance_global: true, empresas: [norte] }),
            200,
        )
        assert.include(global.body(), { alcance_global: true })
        assert.deepEqual(global.body().empresas, [])

        // sin permiso: 403
        await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}/empresas`)
                .bearerToken(token)
                .json({ version: 3, alcance_global: true }),
            403,
        )
    })

    test('quien asigna solo reparte su alcance; un usuario creado por él queda acotado', async ({
        assert,
    }) => {
        const norte = await crearEmpresaFila()
        const sur = await crearEmpresaFila()
        const { usuario } = await usuarioConRoles([])
        const acotado = { ...contextoPrueba(), empresaId: norte, empresasPermitidas: [norte] }

        const global = await new AsignarEmpresasUsuario()
            .execute({ id: usuario.id, version: 1, alcance_global: true }, acotado)
            .catch((e: unknown) => e)
        assert.include(global, { status: 403 })
        const ajena = await new AsignarEmpresasUsuario()
            .execute({ id: usuario.id, version: 1, alcance_global: false, empresas: [sur] }, acotado)
            .catch((e: unknown) => e)
        assert.include(ajena, { status: 403 })

        const creado = await new CrearUsuario().execute(
            { nombre: 'Cajera norte', email: `${unico('cajera')}@prueba.local`, password: 'clave-de-prueba' },
            acotado,
        )
        assert.isFalse(creado.alcance_global)
        assert.deepEqual(creado.empresas, [norte])

        const porGlobal = await new CrearUsuario().execute(
            { nombre: 'Global', email: `${unico('global')}@prueba.local`, password: 'clave-de-prueba' },
            contextoPrueba(),
        )
        assert.isTrue(porGlobal.alcance_global)
        assert.deepEqual(porGlobal.empresas, [])
    })
})
