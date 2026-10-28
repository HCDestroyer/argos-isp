import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import UsuariosClave from '#commands/usuarios_clave'

/**
 * `node ace usuarios:clave` (`sudo argosisp admin-clave <correo>`, A6 con permiso del líder): cambia
 * la clave por `usuarios.editar`, crea el admin por `usuarios.crear` si falta, y audita con actor
 * `sistema`, canal `consola` y la clave como `***`.
 */

async function correr(argumentos: string[], entrada?: string) {
    const kernel = await app.container.make('ace')
    const comando = await kernel.create(UsuariosClave, argumentos)
    if (entrada !== undefined) comando.entrada = Readable.from([entrada])
    await comando.exec()
    return comando
}

async function usuario(correo: string) {
    return (await db
        .from('core.usuarios')
        .whereRaw('lower(email) = ?', [correo])
        .select('id', 'password_hash', 'alcance_global', 'activo')
        .first()) as { id: number; password_hash: string; alcance_global: boolean; activo: boolean } | null
}

async function ultimaAccion(accion: string, entidadId: number) {
    return (await db
        .from('audit.acciones')
        .where({ accion, entidad_tipo: 'usuario', entidad_id: entidadId })
        .orderBy('id', 'desc')
        .first()) as {
        actor_tipo: string
        actor_id: number | null
        canal: string
        resultado: string
        entrada: Record<string, unknown>
    } | null
}

test.group('Consola · usuarios:clave', () => {
    test('crea el admin si no existe, con alcance global y auditoría sin la clave', async ({ assert }) => {
        const correo = `admin-${randomUUID().slice(0, 8)}@argosisp.test`
        const comando = await correr([correo.toUpperCase()])
        assert.equal(comando.exitCode ?? 0, 0)
        assert.isTrue(comando.resultado?.creado)
        const clave = comando.resultado!.clave
        assert.match(clave, /^[A-Za-z0-9]{20}$/)

        const fila = await usuario(correo)
        assert.exists(fila)
        assert.isTrue(fila!.activo)
        assert.isTrue(fila!.alcance_global)
        assert.isTrue(await hash.verify(fila!.password_hash, clave))
        const roles = (await db
            .from('core.usuarios_roles as ur')
            .join('core.roles as r', 'r.id', 'ur.role_id')
            .where('ur.usuario_id', fila!.id)
            .select('r.nombre')) as Array<{ nombre: string }>
        assert.deepEqual(
            roles.map((r) => r.nombre),
            ['admin'],
        )

        const accion = await ultimaAccion('usuarios.crear', fila!.id)
        assert.exists(accion)
        assert.equal(accion!.actor_tipo, 'sistema')
        assert.isNull(accion!.actor_id)
        assert.equal(accion!.canal, 'consola')
        assert.equal(accion!.resultado, 'ok')
        assert.equal(accion!.entrada.password, '***')
        assert.notInclude(JSON.stringify(accion!.entrada), clave)
    })

    test('cambia la clave de un usuario existente (generada y por --stdin) y revoca sus sesiones', async ({
        assert,
    }) => {
        const correo = `soporte-${randomUUID().slice(0, 8)}@argosisp.test`
        const creado = await correr([correo])
        const id = creado.resultado!.usuarioId
        await db.table('core.auth_access_tokens').insert({
            tokenable_id: id,
            type: 'auth_token',
            hash: randomUUID(),
            abilities: '["*"]',
        })

        const generada = await correr([correo])
        assert.isFalse(generada.resultado?.creado)
        assert.equal(generada.resultado?.usuarioId, id)
        assert.notEqual(generada.resultado!.clave, creado.resultado!.clave)
        let fila = await usuario(correo)
        assert.isTrue(await hash.verify(fila!.password_hash, generada.resultado!.clave))
        const sesiones = await db.from('core.auth_access_tokens').where('tokenable_id', id).count('* as n')
        assert.equal(Number(sesiones[0].n), 0)

        const propia = await correr([correo, '--stdin'], 'Clave-Propia-123\n')
        assert.equal(propia.resultado?.clave, 'Clave-Propia-123')
        fila = await usuario(correo)
        assert.isTrue(await hash.verify(fila!.password_hash, 'Clave-Propia-123'))

        const accion = await ultimaAccion('usuarios.editar', id)
        assert.equal(accion!.actor_tipo, 'sistema')
        assert.equal(accion!.canal, 'consola')
        assert.equal(accion!.entrada.password, '***')
        const cambio = (await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'usuario', entidad_id: id, campo: 'clave_cambiada' })
            .orderBy('id', 'desc')
            .first()) as { despues: unknown } | null
        assert.exists(cambio)
        assert.equal(cambio!.despues, true)
    })

    test('rechaza una clave corta por --stdin sin tocar al usuario', async ({ assert }) => {
        const correo = `corta-${randomUUID().slice(0, 8)}@argosisp.test`
        const comando = await correr([correo, '--stdin'], 'corta\n')
        assert.equal(comando.exitCode, 1)
        assert.isNull(await usuario(correo))
    })
})
