import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

const EXCEDE = 'urn:argosisp:problema:rol_excede_permisos'

async function idRol(nombre: string): Promise<number> {
    const fila = (await db.from('core.roles').where('nombre', nombre).select('id').firstOrFail()) as {
        id: number
    }
    return fila.id
}

/** Rol a medida con estos permisos; devuelve su id y nombre. */
async function rolCon(permisos: string[]) {
    const nombre = unico('rol').replace('-', '_')
    const [rol] = (await db.table('core.roles').insert({ nombre }).returning('id')) as Array<{ id: number }>
    const ids = (await db.from('core.permisos').whereIn('nombre', permisos).select('id')) as Array<{
        id: number
    }>
    await db
        .table('core.roles_permisos')
        .multiInsert(ids.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
    return { id: rol!.id, nombre }
}

async function crearZona(): Promise<number> {
    const [fila] = (await db
        .table('core.zonas')
        .insert({ nombre: unico('Zona') })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function version(usuarioId: number): Promise<number> {
    const fila = (await db.from('core.usuarios').where('id', usuarioId).select('version').firstOrFail()) as {
        version: number
    }
    return Number(fila.version)
}

const PERMISOS_GESTION = ['usuarios.ver', 'usuarios.crear', 'usuarios.editar', 'usuarios.asignar_empresas']

/** Soporte que además gestiona usuarios (sin ser admin). */
async function gestorSoporte() {
    const gestor = await rolCon(PERMISOS_GESTION)
    return usuarioConRoles(['soporte', gestor.nombre])
}

test.group('ACL · roles sin escalada de privilegios', () => {
    test('crear usuario: no asigna admin ni roles que el actor no tiene; sí los que cubre', async ({
        client,
        assert,
    }) => {
        const { token } = await gestorSoporte()
        const zona = await crearZona()
        const email = `${unico('escalada')}@prueba.local`

        const rechazo = await estado(
            client
                .post('/api/v1/usuarios')
                .bearerToken(token)
                .json({
                    nombre: 'Escalada',
                    email,
                    password: 'clave-segura-1',
                    roles: [{ role_id: await idRol('admin') }],
                }),
            403,
        )
        assert.equal(rechazo.header('content-type')?.split(';')[0], 'application/problem+json')
        assert.equal(rechazo.body().type, EXCEDE)
        assert.isTrue(
            rechazo
                .body()
                .errors.some((e: { message: string }) => e.message === 'No tienes el permiso roles.crear'),
        )
        assert.isNull(await db.from('core.usuarios').where('email', email).first())

        await estado(
            client
                .post('/api/v1/usuarios')
                .bearerToken(token)
                .json({
                    nombre: 'Soporte nuevo',
                    email: `${unico('ok')}@prueba.local`,
                    password: 'clave-segura-1',
                    roles: [
                        { role_id: await idRol('soporte') },
                        { role_id: await idRol('soporte'), alcance_tipo: 'zona', alcance_id: zona },
                    ],
                }),
            201,
        )
    })

    test('editar usuario: ni a sí mismo ni a otro le da más; no edita a quien tiene más', async ({
        client,
        assert,
    }) => {
        const { token, usuario: actor } = await gestorSoporte()
        const { usuario: soporte } = await usuarioConRoles(['soporte'])
        const { usuario: admin } = await usuarioConRoles(['admin'])
        const { token: tokenAdmin } = await usuarioConRoles(['admin'])
        const misRoles = (await db.from('core.usuarios_roles').where('usuario_id', actor.id)) as Array<{
            role_id: number
        }>

        // a sí mismo
        const propio = await estado(
            client
                .put(`/api/v1/usuarios/${actor.id}`)
                .bearerToken(token)
                .json({
                    version: await version(actor.id),
                    roles: [
                        ...misRoles.map((r) => ({ role_id: r.role_id })),
                        { role_id: await idRol('admin') },
                    ],
                }),
            403,
        )
        assert.equal(propio.body().type, EXCEDE)
        const despues = await db.from('core.usuarios_roles').where('usuario_id', actor.id)
        assert.lengthOf(despues, misRoles.length)

        // a otro
        await estado(
            client
                .put(`/api/v1/usuarios/${soporte.id}`)
                .bearerToken(token)
                .json({ version: await version(soporte.id), roles: [{ role_id: await idRol('admin') }] }),
            403,
        )

        // tomar la cuenta de un admin cambiándole la contraseña
        const cuenta = await estado(
            client
                .put(`/api/v1/usuarios/${admin.id}`)
                .bearerToken(token)
                .json({ version: await version(admin.id), password: 'otra-clave-99' }),
            403,
        )
        assert.equal(cuenta.body().type, EXCEDE)
        // ni quitarle las empresas
        await estado(
            client
                .put(`/api/v1/usuarios/${admin.id}/empresas`)
                .bearerToken(token)
                .json({ version: await version(admin.id), alcance_global: true }),
            403,
        )

        // lo que sí cubre
        await estado(
            client
                .put(`/api/v1/usuarios/${soporte.id}`)
                .bearerToken(token)
                .json({
                    version: await version(soporte.id),
                    nombre: 'Soporte B',
                    password: 'nueva-clave-12',
                }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/usuarios/${actor.id}`)
                .bearerToken(token)
                .json({ version: await version(actor.id), nombre: 'Yo mismo' }),
            200,
        )
        // un admin global edita a cualquiera
        await estado(
            client
                .put(`/api/v1/usuarios/${admin.id}`)
                .bearerToken(tokenAdmin)
                .json({ version: await version(admin.id), roles: [{ role_id: await idRol('soporte') }] }),
            200,
        )
    })

    test('el alcance por zona del actor limita el de los roles que asigna', async ({ client }) => {
        const zona1 = await crearZona()
        const zona2 = await crearZona()
        const gestor = await rolCon(PERMISOS_GESTION)
        const { usuario: actor, token } = await usuarioConRoles([gestor.nombre])
        const soporte = await idRol('soporte')
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: actor.id, role_id: soporte, alcance_tipo: 'zona', alcance_id: zona1 })
        const { usuario: destino } = await usuarioConRoles([])
        const asignar = async (roles: unknown[], status: number) =>
            estado(
                client
                    .put(`/api/v1/usuarios/${destino.id}`)
                    .bearerToken(token)
                    .json({ version: await version(destino.id), roles }),
                status,
            )

        await asignar([{ role_id: soporte }], 403)
        await asignar([{ role_id: soporte, alcance_tipo: 'zona', alcance_id: zona2 }], 403)
        await asignar([{ role_id: soporte, alcance_tipo: 'zona', alcance_id: zona1 }], 200)
    })

    test('roles: no crea ni amplía un rol con permisos que el actor no tiene sin alcance', async ({
        client,
        assert,
    }) => {
        const gestorRoles = await rolCon(['roles.ver', 'roles.crear', 'roles.editar', 'clientes.ver'])
        const { usuario: actor, token } = await usuarioConRoles([gestorRoles.nombre])

        const creado = await estado(
            client
                .post('/api/v1/roles')
                .bearerToken(token)
                .json({ nombre: unico('rol').replace('-', '_'), permisos: ['usuarios.crear'] }),
            403,
        )
        assert.equal(creado.body().type, EXCEDE)
        const propio = await estado(
            client
                .post('/api/v1/roles')
                .bearerToken(token)
                .json({ nombre: unico('rol').replace('-', '_'), permisos: ['clientes.ver'] }),
            201,
        )

        // ampliar su propio rol: lo que agrega no cuenta como suyo
        const miRol = (await db.from('core.roles').where('id', gestorRoles.id).firstOrFail()) as {
            version: number
        }
        const ampliar = await estado(
            client
                .put(`/api/v1/roles/${gestorRoles.id}`)
                .bearerToken(token)
                .json({
                    version: Number(miRol.version),
                    permisos: ['roles.ver', 'roles.crear', 'roles.editar', 'clientes.ver', 'usuarios.editar'],
                }),
            403,
        )
        assert.equal(ampliar.body().type, EXCEDE)
        const permisos = await db
            .from('core.roles_permisos as rp')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('rp.role_id', gestorRoles.id)
            .select('p.nombre')
        assert.notInclude(
            permisos.map((p: { nombre: string }) => p.nombre),
            'usuarios.editar',
        )

        // quitar permisos o agregar los que tiene: permitido
        await estado(
            client
                .put(`/api/v1/roles/${propio.body().id}`)
                .bearerToken(token)
                .json({ version: propio.body().version, permisos: ['clientes.ver', 'roles.ver'] }),
            200,
        )

        // con el permiso solo en una zona, no lo da a un rol (que se asigna sin alcance)
        const zona = await crearZona()
        const lectura = await rolCon(['zonas.ver'])
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: actor.id, role_id: lectura.id, alcance_tipo: 'zona', alcance_id: zona })
        await estado(
            client
                .post('/api/v1/roles')
                .bearerToken(token)
                .json({ nombre: unico('rol').replace('-', '_'), permisos: ['zonas.ver'] }),
            403,
        )
    })
})
