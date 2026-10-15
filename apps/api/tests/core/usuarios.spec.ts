import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { alcanceDePermiso, permite } from '#core/acl'
import { NOMBRES_PERMISOS, ROLES_BASE } from '#core/permisos'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

async function idRol(nombre: string): Promise<number> {
    const fila = (await db.from('core.roles').where('nombre', nombre).select('id').firstOrFail()) as {
        id: number
    }
    return fila.id
}

async function crearZona(): Promise<number> {
    const [fila] = (await db
        .table('core.zonas')
        .insert({ nombre: unico('Zona') })
        .returning('id')) as Array<{
        id: number
    }>
    return fila!.id
}

test.group('ACL · usuarios', () => {
    test('admin crea, lista, ve y edita un usuario; queda auditado', async ({ client, assert }) => {
        const { token, usuario: admin } = await usuarioConRoles(['admin'])
        const email = `${unico('nuevo')}@prueba.local`
        const zonaId = await crearZona()

        const creado = await estado(
            client
                .post('/api/v1/usuarios')
                .bearerToken(token)
                .json({
                    nombre: 'Cajera Uno',
                    email: email.toUpperCase(),
                    password: 'clave-segura-1',
                    roles: [
                        { role_id: await idRol('cajero') },
                        { role_id: await idRol('soporte'), alcance_tipo: 'zona', alcance_id: zonaId },
                    ],
                }),
            201,
        )
        const u = creado.body()
        assert.equal(u.email, email)
        assert.equal(u.version, 1)
        assert.notProperty(u, 'password_hash')
        assert.sameDeepMembers(
            u.roles.map((r: { rol: string; alcance_tipo: string | null }) => [r.rol, r.alcance_tipo]),
            [
                ['cajero', null],
                ['soporte', 'zona'],
            ],
        )

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'usuarios.crear', entidad_id: u.id })
            .firstOrFail()
        assert.equal(accion.actor_id, admin.id)
        assert.equal(accion.entrada.password, '***')

        // el nuevo usuario puede iniciar sesión
        await estado(client.post('/api/v1/auth/login').json({ email, password: 'clave-segura-1' }), 200)

        const visto = await estado(client.get(`/api/v1/usuarios/${u.id}`).bearerToken(token), 200)
        assert.deepEqual(visto.body(), u)

        const pagina = await estado(client.get('/api/v1/usuarios').qs({ limit: 200 }).bearerToken(token), 200)
        assert.isTrue(pagina.body().data.some((x: { id: number }) => x.id === u.id))

        const editado = await estado(
            client
                .put(`/api/v1/usuarios/${u.id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Cajera Uno B', password: 'otra-clave-2', roles: [] }),
            200,
        )
        assert.equal(editado.body().version, 2)
        assert.deepEqual(editado.body().roles, [])

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'usuario', entidad_id: u.id })
            .orderBy('id')
        const campos = cambios.map((c) => c.campo)
        assert.includeMembers(campos, ['nombre', 'roles', 'clave_cambiada'])
        assert.isFalse(JSON.stringify(cambios).includes('otra-clave-2'))

        // contraseña nueva: la vieja ya no sirve
        await estado(client.post('/api/v1/auth/login').json({ email, password: 'clave-segura-1' }), 401)
        await estado(client.post('/api/v1/auth/login').json({ email, password: 'otra-clave-2' }), 200)
    })

    test('editar con una version vieja devuelve 409', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { usuario } = await usuarioConRoles(['lectura'])
        await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Uno' }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/usuarios/${usuario.id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Dos' }),
            409,
        )
    })

    test('correo duplicado → 409; rol o alcance inexistente → 422', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post('/api/v1/usuarios')
                .bearerToken(token)
                .json({ nombre: 'Admin bis', email: 'admin@argosisp.local', password: 'clave-larga-1' }),
            409,
        )
        const respuesta = await estado(
            client
                .post('/api/v1/usuarios')
                .bearerToken(token)
                .json({
                    nombre: 'Sin rol',
                    email: `${unico('x')}@prueba.local`,
                    password: 'clave-larga-1',
                    roles: [
                        { role_id: 999999 },
                        { role_id: await idRol('tecnico'), alcance_tipo: 'router', alcance_id: 999999 },
                    ],
                }),
            422,
        )
        assert.sameMembers(
            respuesta.body().errors.map((e: { field: string }) => e.field),
            ['roles.0.role_id', 'roles.1.alcance_id'],
        )
    })

    test('desactivar a un usuario corta sus sesiones; no puedes desactivarte a ti mismo', async ({
        client,
    }) => {
        const { token, usuario: admin } = await usuarioConRoles(['admin'])
        const otro = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/me').bearerToken(otro.token), 200)
        await estado(
            client
                .put(`/api/v1/usuarios/${otro.usuario.id}`)
                .bearerToken(token)
                .json({ version: 1, activo: false }),
            200,
        )
        await estado(client.get('/api/v1/me').bearerToken(otro.token), 401)
        await estado(
            client.put(`/api/v1/usuarios/${admin.id}`).bearerToken(token).json({ version: 1, activo: false }),
            422,
        )
    })

    test('lectura no puede crear usuarios', async ({ client }) => {
        const { token } = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/usuarios').bearerToken(token), 200)
        await estado(
            client
                .post('/api/v1/usuarios')
                .bearerToken(token)
                .json({ nombre: 'X', email: `${unico('x')}@prueba.local`, password: 'clave-larga-1' }),
            403,
        )
    })
})

test.group('ACL · roles y permisos', () => {
    test('catálogo de permisos y roles base del seed', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const permisos = await estado(client.get('/api/v1/permisos').bearerToken(token), 200)
        assert.sameMembers(
            permisos.body().map((p: { nombre: string }) => p.nombre),
            NOMBRES_PERMISOS,
        )

        const roles = await estado(client.get('/api/v1/roles').bearerToken(token), 200)
        const porNombre = new Map(roles.body().map((r: { nombre: string }) => [r.nombre, r]))
        for (const [nombre, rol] of Object.entries(ROLES_BASE)) {
            const visto = porNombre.get(nombre) as { permisos: string[] }
            assert.sameMembers(visto.permisos, [...rol.permisos], nombre)
        }
        const cajero = porNombre.get('cajero') as { permisos: string[] }
        assert.notInclude(cajero.permisos, 'servicios.suspender')
    })

    test('crear y editar un rol propio; los permisos de un rol base no se editan', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const nombre = unico('cobrador').replace('-', '_')
        const creado = await estado(
            client
                .post('/api/v1/roles')
                .bearerToken(token)
                .json({
                    nombre,
                    descripcion: 'Cobro en ruta',
                    permisos: ['pagos.registrar', 'clientes.ver'],
                }),
            201,
        )
        assert.sameMembers(creado.body().permisos, ['pagos.registrar', 'clientes.ver'])

        const editado = await estado(
            client
                .put(`/api/v1/roles/${creado.body().id}`)
                .bearerToken(token)
                .json({ version: 1, permisos: ['clientes.ver'] }),
            200,
        )
        assert.deepEqual(editado.body().permisos, ['clientes.ver'])
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'rol', entidad_id: creado.body().id, campo: 'permisos' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual(cambio.despues, ['clientes.ver'])

        await estado(client.post('/api/v1/roles').bearerToken(token).json({ nombre, permisos: [] }), 409)
        await estado(
            client
                .put(`/api/v1/roles/${await idRol('cajero')}`)
                .bearerToken(token)
                .json({ version: 1, permisos: ['servicios.suspender'] }),
            422,
        )
    })
})

test.group('ACL · tokens de API', () => {
    test('un token es su usuario con permisos recortados y queda como actor token', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { usuario } = await usuarioConRoles(['soporte'])

        const creado = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({
                    usuario_id: usuario.id,
                    nombre: 'Agente IA',
                    alcances: { permisos: ['bitacora.ver', 'zonas.ver', 'zonas.crear'] },
                }),
            201,
        )
        const { token, datos } = creado.body()
        assert.match(token, /^atk_/)
        assert.notProperty(datos, 'hash')
        const fila = await db.from('core.tokens_api').where('id', datos.id).firstOrFail()
        assert.notEqual(fila.hash, token)

        const me = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        // soporte no tiene zonas.crear: el token no lo agrega
        assert.sameMembers(me.body().permisos, ['bitacora.ver', 'zonas.ver'])

        await estado(client.get('/api/v1/roles').bearerToken(token), 403)
        await estado(client.get('/api/v1/bitacora/acciones').bearerToken(token), 200)

        // una acción con token queda auditada con actor_tipo = token
        const requestId = unico('req-token')
        await estado(
            client.post('/api/v1/auth/logout').bearerToken(token).header('X-Request-Id', requestId),
            400,
        )

        const revocado = await estado(
            client.post(`/api/v1/tokens/${datos.id}/revocar`).bearerToken(admin),
            200,
        )
        assert.isNotNull(revocado.body().revocado_en)
        await estado(client.get('/api/v1/me').bearerToken(token), 401)

        const lista = await estado(client.get('/api/v1/tokens').bearerToken(admin), 200)
        assert.isTrue(lista.body().data.some((t: { id: number }) => t.id === datos.id))
    })

    test('las acciones hechas con un token registran actor_tipo token', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { usuario } = await usuarioConRoles(['admin'])
        const creado = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({ usuario_id: usuario.id, nombre: 'Integración' }),
            201,
        )
        const requestId = unico('req')
        await estado(
            client
                .post('/api/v1/roles')
                .bearerToken(creado.body().token)
                .header('X-Request-Id', requestId)
                .json({ nombre: unico('rol').replace('-', '_'), permisos: [] }),
            201,
        )
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.actor_tipo, 'token')
        assert.equal(accion.actor_id, usuario.id)
    })

    test('token con permiso desconocido → 422', async ({ client }) => {
        const { token: admin, usuario } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({ usuario_id: usuario.id, nombre: 'Malo', alcances: { permisos: ['no.existe'] } }),
            422,
        )
    })
})

test.group('ACL · alcance por router, zona y caja', () => {
    test('alcanceDePermiso: global gana; con alcance se acumulan ids', async ({ assert }) => {
        const zona1 = await crearZona()
        const zona2 = await crearZona()
        const { usuario } = await usuarioConRoles([])
        const soporte = await idRol('soporte')
        const lectura = await idRol('lectura')
        await db.table('core.usuarios_roles').multiInsert([
            { usuario_id: usuario.id, role_id: soporte, alcance_tipo: 'zona', alcance_id: zona1 },
            { usuario_id: usuario.id, role_id: soporte, alcance_tipo: 'zona', alcance_id: zona2 },
        ])

        const alcance = await alcanceDePermiso(usuario.id, 'clientes.ver')
        assert.deepEqual(alcance, { rol: { router: [], zona: [zona1, zona2], caja: [] }, token: null })
        assert.isNull(await alcanceDePermiso(usuario.id, 'usuarios.ver'))

        assert.isTrue(permite(alcance!, { zona: [zona1] }))
        assert.isFalse(permite(alcance!, { zona: [999999] }))
        assert.isFalse(permite(alcance!, { zona: [null] }))
        // un recurso sin dimensión zona no queda restringido por un alcance de zona
        assert.isTrue(permite(alcance!, { caja: [1] }))

        await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: lectura })
        assert.deepEqual(await alcanceDePermiso(usuario.id, 'clientes.ver'), { rol: null, token: null })

        const conToken = await alcanceDePermiso(usuario.id, 'clientes.ver', { zonas: [zona2] })
        assert.isTrue(permite(conToken!, { zona: [zona2] }))
        assert.isFalse(permite(conToken!, { zona: [zona1] }))
        assert.isNull(await alcanceDePermiso(usuario.id, 'clientes.ver', { permisos: ['zonas.ver'] }))
    })
})
