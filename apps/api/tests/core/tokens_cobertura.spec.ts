import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { canalPermitido } from '#middleware/request_id_middleware'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

const EXCEDE = 'urn:argosisp:problema:token_excede_permisos'

/** Rol a medida con estos permisos; devuelve su nombre. */
async function rolCon(permisos: string[]): Promise<string> {
    const nombre = unico('rol').replace('-', '_')
    const [rol] = (await db.table('core.roles').insert({ nombre }).returning('id')) as Array<{ id: number }>
    const ids = (await db.from('core.permisos').whereIn('nombre', permisos).select('id')) as Array<{
        id: number
    }>
    await db
        .table('core.roles_permisos')
        .multiInsert(ids.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
    return nombre
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

async function idRol(nombre: string): Promise<number> {
    const fila = (await db.from('core.roles').where('nombre', nombre).select('id').firstOrFail()) as {
        id: number
    }
    return fila.id
}

/** Usuario de soporte que además administra tokens (sin ser admin). */
async function gestorSoporte() {
    const gestor = await rolCon(['tokens.crear', 'tokens.revocar', 'tokens.ver'])
    return usuarioConRoles(['soporte', gestor])
}

test.group('ACL · tokens sin escalada de privilegios', () => {
    test('no crea un token para un admin ni con permisos que no tiene; sí para lo que cubre', async ({
        client,
        assert,
    }) => {
        const { token: gestor } = await gestorSoporte()
        const { usuario: admin } = await usuarioConRoles(['admin'])
        const { usuario: soporte } = await usuarioConRoles(['soporte'])
        const antes = await db.from('core.tokens_api').where('usuario_id', admin.id).count('* as n').first()

        const rechazo = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(gestor)
                .json({ usuario_id: admin.id, nombre: 'Escalada' }),
            403,
        )
        assert.equal(rechazo.header('content-type')?.split(';')[0], 'application/problem+json')
        assert.equal(rechazo.body().type, EXCEDE)
        assert.isTrue(
            rechazo
                .body()
                .errors.some((e: { message: string }) => e.message === 'No tienes el permiso usuarios.crear'),
        )
        const despues = await db.from('core.tokens_api').where('usuario_id', admin.id).count('* as n').first()
        assert.equal(Number(despues.n), Number(antes.n))
        // el rechazo queda auditado
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'tokens.crear')
            .whereRaw("entrada->>'usuario_id' = ?", [String(admin.id)])
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.notEqual(auditoria.resultado, 'ok')

        // pedir explícitamente un permiso que el actor no tiene
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(gestor)
                .json({ usuario_id: admin.id, nombre: 'Roles', alcances: { permisos: ['roles.crear'] } }),
            403,
        )

        // un admin, recortado a permisos que el actor sí tiene: permitido
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(gestor)
                .json({ usuario_id: admin.id, nombre: 'Lectura', alcances: { permisos: ['clientes.ver'] } }),
            201,
        )
        // un usuario con los mismos permisos que el actor: permitido
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(gestor)
                .json({ usuario_id: soporte.id, nombre: 'Soporte' }),
            201,
        )
    })

    test('un admin global crea tokens para cualquiera', async ({ client }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { usuario: otroAdmin } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({ usuario_id: otroAdmin.id, nombre: 'Integración' }),
            201,
        )
    })

    test('el alcance por zona del actor limita el del token', async ({ client, assert }) => {
        const zona1 = await crearZona()
        const zona2 = await crearZona()
        const gestor = await rolCon(['tokens.crear'])
        const { usuario: actor, token } = await usuarioConRoles([gestor])
        await db.table('core.usuarios_roles').insert({
            usuario_id: actor.id,
            role_id: await idRol('soporte'),
            alcance_tipo: 'zona',
            alcance_id: zona1,
        })
        const { usuario: soporte } = await usuarioConRoles(['soporte'])
        const permisos = ['clientes.ver', 'servicios.ver']

        const sinZona = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(token)
                .json({ usuario_id: soporte.id, nombre: 'Global', alcances: { permisos } }),
            403,
        )
        assert.equal(sinZona.body().type, EXCEDE)
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(token)
                .json({
                    usuario_id: soporte.id,
                    nombre: 'Otra zona',
                    alcances: { permisos, zonas: [zona2] },
                }),
            403,
        )
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(token)
                .json({ usuario_id: soporte.id, nombre: 'Su zona', alcances: { permisos, zonas: [zona1] } }),
            201,
        )
    })

    test('un token de API solo crea tokens dentro de sus propios alcances', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { usuario: integrador } = await usuarioConRoles(['admin'])
        const { usuario: soporte } = await usuarioConRoles(['soporte'])
        const creado = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin)
                .json({
                    usuario_id: integrador.id,
                    nombre: 'Gestor recortado',
                    alcances: { permisos: ['tokens.crear', 'clientes.ver'] },
                }),
            201,
        )
        const atk = creado.body().token

        const rechazo = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(atk)
                .json({ usuario_id: soporte.id, nombre: 'Más que yo' }),
            403,
        )
        assert.equal(rechazo.body().type, EXCEDE)
        // el usuario del token es admin, pero el token solo tiene dos permisos: no puede darse más
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(atk)
                .json({ usuario_id: integrador.id, nombre: 'Clon' }),
            403,
        )
        await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(atk)
                .json({
                    usuario_id: soporte.id,
                    nombre: 'Lectura',
                    alcances: { permisos: ['clientes.ver'] },
                }),
            201,
        )
    })

    test('sin alcance global de empresas no crea tokens de un usuario con alcance global', async ({
        client,
        assert,
    }) => {
        const empresa = (await db.from('core.empresas').orderBy('id', 'asc').select('id').firstOrFail()) as {
            id: number
        }
        const { usuario: actor, token } = await usuarioConRoles(['admin'])
        await db.from('core.usuarios').where('id', actor.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: actor.id, empresa_id: empresa.id })
        const { usuario: global } = await usuarioConRoles(['lectura'])
        const { usuario: local } = await usuarioConRoles(['lectura'])
        await db.from('core.usuarios').where('id', local.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: local.id, empresa_id: empresa.id })

        const rechazo = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(token)
                .json({ usuario_id: global.id, nombre: 'Global' }),
            403,
        )
        assert.equal(rechazo.body().type, EXCEDE)
        assert.equal(rechazo.body().errors[0].field, 'usuario_id')
        await estado(
            client.post('/api/v1/tokens').bearerToken(token).json({ usuario_id: local.id, nombre: 'Local' }),
            201,
        )
    })

    test('revocar: los propios siempre; los de otro solo si el actor los cubre', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { token: gestor, usuario: actor } = await gestorSoporte()
        const { usuario: otroAdmin } = await usuarioConRoles(['admin'])
        const { usuario: soporte } = await usuarioConRoles(['soporte'])

        const crear = async (usuarioId: number) => {
            const respuesta = await estado(
                client
                    .post('/api/v1/tokens')
                    .bearerToken(admin)
                    .json({ usuario_id: usuarioId, nombre: 'Token de prueba' }),
                201,
            )
            return respuesta.body().datos.id as number
        }

        const deAdmin = await crear(otroAdmin.id)
        const rechazo = await estado(
            client.post(`/api/v1/tokens/${deAdmin}/revocar`).bearerToken(gestor),
            403,
        )
        assert.equal(rechazo.body().type, EXCEDE)
        const fila = await db.from('core.tokens_api').where('id', deAdmin).firstOrFail()
        assert.isNull(fila.revocado_en)

        await estado(
            client.post(`/api/v1/tokens/${await crear(soporte.id)}/revocar`).bearerToken(gestor),
            200,
        )
        await estado(client.post(`/api/v1/tokens/${await crear(actor.id)}/revocar`).bearerToken(gestor), 200)
        await estado(client.post(`/api/v1/tokens/${deAdmin}/revocar`).bearerToken(admin), 200)
    })
})

test.group('Auditoría · X-Canal', () => {
    test('un request HTTP no puede declararse cron, worker, webhook, interno ni consola', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const canalDe = async (canal: string) => {
            const requestId = unico('req-canal')
            await estado(
                client
                    .post('/api/v1/roles')
                    .bearerToken(token)
                    .header('X-Request-Id', requestId)
                    .header('X-Canal', canal)
                    .json({ nombre: unico('rol').replace('-', '_'), permisos: [] }),
                201,
            )
            const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
            return accion.canal as string
        }

        for (const interno of ['cron', 'worker', 'webhook', 'interno', 'consola', 'inventado']) {
            assert.equal(await canalDe(interno), 'api', `X-Canal: ${interno}`)
        }
        for (const http of ['panel', 'portal', 'api', 'ia']) {
            assert.equal(await canalDe(http), http, `X-Canal: ${http}`)
        }
    })

    test('canalPermitido: los internos solo con el token interno', ({ assert }) => {
        assert.equal(canalPermitido('panel', false), 'panel')
        assert.equal(canalPermitido('ia', false), 'ia')
        assert.isNull(canalPermitido('worker', false))
        assert.isNull(canalPermitido('consola', false))
        assert.equal(canalPermitido('worker', true), 'worker')
        assert.isNull(canalPermitido(null, true))
    })
})
