import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Tarea 8 (resto): endpoints manuales de estado del operador. Llaman `CambiarEstadoServicio`
 * anidada; el permiso es el nombre de la acción.
 */

async function servicio(estadoInicial = 'activo') {
    const id = await crearServicioFila({ cliente_id: await crearClienteFila() })
    if (estadoInicial !== 'activo') {
        await db.from('core.servicios').where('id', id).update({ estado: estadoInicial })
    }
    return id
}

const eventosEstado = (servicioId: number) =>
    db
        .from('audit.outbox')
        .where('evento', 'servicio.estado_cambiado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')

test.group('Servicios · acciones manuales de estado', () => {
    test('soporte: suspender → reactivar → limitar → quitar-limite, con evento y auditoría por paso', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const id = await servicio()

        const pasos: Array<[string, string]> = [
            ['suspender', 'suspendido'],
            ['reactivar', 'activo'],
            ['limitar', 'limitado'],
            ['quitar-limite', 'activo'],
        ]
        for (const [accion, esperado] of pasos) {
            const r = await estado(
                client
                    .post(`/api/v1/servicios/${id}/${accion}`)
                    .bearerToken(token)
                    .header('X-Canal', 'panel')
                    .json({ motivo: `prueba ${accion}` }),
                200,
            )
            assert.equal(r.body().estado, esperado)
            assert.equal(r.body().id, id)
        }

        const emitidos = await eventosEstado(id)
        assert.deepEqual(
            emitidos.map((e) => [e.payload.de, e.payload.a, e.payload.motivo]),
            [
                ['activo', 'suspendido', 'prueba suspender'],
                ['suspendido', 'activo', 'prueba reactivar'],
                ['activo', 'limitado', 'prueba limitar'],
                ['limitado', 'activo', 'prueba quitar-limite'],
            ],
        )

        const acciones = await db
            .from('audit.acciones')
            .where({ entidad_tipo: 'servicio', entidad_id: id, resultado: 'ok' })
            .orderBy('id')
            .select('accion', 'actor_id', 'canal')
        const nombres = acciones.map((a) => a.accion)
        for (const permiso of [
            'servicios.suspender',
            'servicios.reactivar',
            'servicios.limitar',
            'servicios.quitar_limite',
        ]) {
            assert.include(nombres, permiso)
        }
        // la transición anidada queda auditada con el mismo actor y canal
        assert.include(nombres, 'servicios.cambiar_estado')
        assert.isTrue(acciones.every((a) => a.actor_id === usuario.id && a.canal === 'panel'))
    })

    test('cajero recibe 403 en servicios.suspender y el servicio no cambia', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const id = await servicio()
        await estado(
            client.post(`/api/v1/servicios/${id}/suspender`).bearerToken(token).json({ motivo: 'no debe' }),
            403,
        )
        const fila = await db.from('core.servicios').where('id', id).firstOrFail()
        assert.equal(fila.estado, 'activo')
        assert.lengthOf(await eventosEstado(id), 0)
    })

    test('motivo obligatorio: 422 sin motivo', async ({ client }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const id = await servicio()
        await estado(client.post(`/api/v1/servicios/${id}/suspender`).bearerToken(token).json({}), 422)
        await estado(
            client.post(`/api/v1/servicios/${id}/limitar`).bearerToken(token).json({ motivo: '' }),
            422,
        )
    })

    test('origen inválido: quitar-limite a un activo o suspendido da 422 transicion_invalida', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const suspendido = await servicio('suspendido')
        const r = await estado(
            client
                .post(`/api/v1/servicios/${suspendido}/quitar-limite`)
                .bearerToken(token)
                .json({ motivo: 'no aplica' }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:transicion_invalida')
        assert.lengthOf(await eventosEstado(suspendido), 0)
    })

    test('mismo estado: 200 sin evento (idempotente); retirado: 422', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const id = await servicio('suspendido')
        const r = await estado(
            client.post(`/api/v1/servicios/${id}/suspender`).bearerToken(token).json({ motivo: 'otra vez' }),
            200,
        )
        assert.equal(r.body().estado, 'suspendido')
        assert.lengthOf(await eventosEstado(id), 0)

        const retirado = await servicio('retirado')
        await estado(
            client
                .post(`/api/v1/servicios/${retirado}/reactivar`)
                .bearerToken(token)
                .json({ motivo: 'no vuelve' }),
            422,
        )
    })

    test('Idempotency-Key: repetir suspender devuelve la misma respuesta sin otro evento', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const id = await servicio()
        const clave = unico('idem')
        const primera = await estado(
            client
                .post(`/api/v1/servicios/${id}/suspender`)
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ motivo: 'mora' }),
            200,
        )
        const segunda = await estado(
            client
                .post(`/api/v1/servicios/${id}/suspender`)
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ motivo: 'mora' }),
            200,
        )
        assert.equal(segunda.header('idempotent-replayed'), 'true')
        assert.deepEqual(segunda.body(), primera.body())
        assert.lengthOf(await eventosEstado(id), 1)
    })

    test('servicio inexistente: 404', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client.post('/api/v1/servicios/999999999/suspender').bearerToken(token).json({ motivo: 'nada' }),
            404,
        )
    })
})
