import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import EditarCliente from '#core/actions/editar_cliente'
import { contextoCliente, usuarioDelActor } from '#shared/contexto'
import { construirOpenApi } from '#shared/openapi/documento'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'

/**
 * Semana 3, tarea 6: tipo de actor `cliente` (acciones del portal autenticado, `a5.md:21`).
 */

test.group('Auditoría · actor cliente', () => {
    test('una acción con contextoCliente queda en audit.acciones y audit.cambios con el cliente', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila({ telefono: '22223333' })
        const cliente = await db.from('core.clientes').where('id', clienteId).firstOrFail()
        const ctx = contextoCliente(clienteId, `prueba-actor-cliente-${clienteId}`)
        assert.deepEqual(ctx.actor, { tipo: 'cliente', id: clienteId })
        assert.equal(ctx.canal, 'portal')

        await new EditarCliente().execute(
            { id: clienteId, version: cliente.version, telefono: '55556666' },
            ctx,
        )

        const accion = await db.from('audit.acciones').where('request_id', ctx.requestId).firstOrFail()
        assert.containsSubset(accion, { actor_tipo: 'cliente', canal: 'portal', accion: 'clientes.editar' })
        assert.equal(Number(accion.actor_id), clienteId)
        const cambio = await db.from('audit.cambios').where('request_id', ctx.requestId).firstOrFail()
        assert.equal(cambio.actor_tipo, 'cliente')
        assert.equal(Number(cambio.actor_id), clienteId)

        // la bitácora nombra al cliente (y no al usuario que tenga el mismo id)
        const { token } = await usuarioConRoles(['admin'])
        const acciones = await estado(
            client.get('/api/v1/bitacora/acciones').qs({ request_id: ctx.requestId }).bearerToken(token),
            200,
        )
        assert.containsSubset(acciones.body().data[0], {
            actor_tipo: 'cliente',
            actor_id: clienteId,
            actor_nombre: cliente.nombre,
        })
        const cambios = await estado(
            client.get('/api/v1/bitacora/cambios').qs({ request_id: ctx.requestId }).bearerToken(token),
            200,
        )
        assert.equal(cambios.body().data[0].actor_nombre, cliente.nombre)
    })

    test('usuarioDelActor: solo usuarios, tokens y agentes tienen id de usuario', ({ assert }) => {
        assert.equal(usuarioDelActor({ tipo: 'usuario', id: 3 }), 3)
        assert.equal(usuarioDelActor({ tipo: 'token', id: 4 }), 4)
        assert.equal(usuarioDelActor({ tipo: 'agente', id: 5 }), 5)
        assert.isNull(usuarioDelActor({ tipo: 'cliente', id: 6 }))
        assert.isNull(usuarioDelActor({ tipo: 'sistema', id: null }))
    })

    test('el OpenAPI declara cliente en actor_tipo', async ({ assert }) => {
        const esquemas = JSON.parse(await construirOpenApi()).components.schemas
        assert.include(esquemas.AccionAuditoria.properties.actor_tipo.enum, 'cliente')
        assert.include(esquemas.CambioAuditoria.properties.actor_tipo.enum, 'cliente')
    })
})
