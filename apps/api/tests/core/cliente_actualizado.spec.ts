import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearZonaFila } from '#tests/core/fabricas'
import CrearCliente from '#core/actions/crear_cliente'
import EditarCliente from '#core/actions/editar_cliente'

/**
 * `cliente.actualizado` con los campos de la instantánea de Iris (contrato Iris 0.3.1 §2.2):
 * teléfono, móvil, dirección, coordenadas y zona, además de la identidad (`tests/core/horus.spec.ts`).
 */

async function eventosCliente(clienteId: number) {
    return db
        .from('audit.outbox')
        .where('evento', 'cliente.actualizado')
        .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        .orderBy('id')
}

test.group('Iris 0.3.1 · cliente.actualizado con teléfono, dirección y coordenadas', () => {
    test('emite los nombres de los campos de la instantánea de Iris, nunca sus valores', async ({
        assert,
    }) => {
        const ctx = contextoPrueba()
        const cliente = await new CrearCliente().execute({ nombre: unico('Cliente') }, ctx)
        const zonaId = await crearZonaFila()
        const editado = await new EditarCliente().execute(
            {
                id: cliente.id,
                version: cliente.version,
                telefono: '2222-0001',
                movil: '5555-0001',
                direccion: 'Zona 1, 5a avenida',
                coordenadas: '14.6349,-90.5069',
                zona_id: zonaId,
            },
            ctx,
        )
        const [evento, ...otros] = await eventosCliente(cliente.id)
        assert.lengthOf(otros, 0)
        assert.deepEqual(evento.payload, {
            cliente_id: cliente.id,
            campos: ['telefono', 'movil', 'direccion', 'coordenadas', 'zona_id'],
        })
        assert.equal(evento.request_id, ctx.requestId)
        const texto = JSON.stringify(evento.payload)
        for (const valor of ['2222-0001', '5555-0001', 'Zona 1', '14.6349']) assert.notInclude(texto, valor)

        // el diff (con valores) queda en audit.cambios, como siempre
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: cliente.id })
            .whereIn('campo', ['telefono', 'direccion', 'coordenadas'])
        assert.lengthOf(cambios, 3)

        // quitar la ubicación también avisa; el correo también desde Iris 0.5.0 (pedido A11)
        const sinUbicacion = await new EditarCliente().execute(
            {
                id: cliente.id,
                version: editado.version,
                coordenadas: null,
                email: `${unico('c')}@ejemplo.gt`,
            },
            ctx,
        )
        const eventos = await eventosCliente(cliente.id)
        assert.lengthOf(eventos, 2)
        assert.deepEqual(eventos[1].payload.campos, ['coordenadas', 'email'])

        // un campo que nadie muestra fuera de Argos (canal preferido) no avisa
        await new EditarCliente().execute(
            { id: cliente.id, version: sinUbicacion.version, canal_preferido: 'whatsapp' },
            ctx,
        )
        assert.lengthOf(await eventosCliente(cliente.id), 2)
    })
})
