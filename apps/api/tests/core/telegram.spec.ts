import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import VincularTelegramCliente from '#core/actions/vincular_telegram_cliente'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'

/**
 * `clientes.vincular_telegram` y `clientes.desvincular_telegram` (fila de A6).
 */

async function cambios(clienteId: number, requestId: string) {
    const filas = await db
        .from('audit.cambios')
        .where({ entidad_tipo: 'cliente', entidad_id: clienteId, request_id: requestId })
        .select('campo', 'antes', 'despues')
    return filas as Array<{ campo: string; antes: unknown; despues: unknown }>
}

test.group('Clientes · Telegram', () => {
    test('vincular fija el chat con diff y auditoría; reemplazar y desvincular también; repetir no cambia', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clienteId = await crearClienteFila()

        const req1 = unico('req')
        const vinculado = await estado(
            client
                .post(`/api/v1/clientes/${clienteId}/vincular-telegram`)
                .bearerToken(token)
                .header('X-Request-Id', req1)
                .json({ chat_id: '123456789' }),
            200,
        )
        assert.equal(vinculado.body().telegram_chat_id, '123456789')
        assert.equal(vinculado.body().version, 2)
        assert.deepEqual(await cambios(clienteId, req1), [
            { campo: 'telegram_chat_id', antes: null, despues: '123456789' },
        ])
        const accion = await db.from('audit.acciones').where('request_id', req1).firstOrFail()
        assert.equal(accion.accion, 'clientes.vincular_telegram')
        assert.equal(accion.entidad_id, clienteId)

        // mismo chat: sin cambios ni versión nueva
        const req2 = unico('req')
        const igual = await estado(
            client
                .post(`/api/v1/clientes/${clienteId}/vincular-telegram`)
                .bearerToken(token)
                .header('X-Request-Id', req2)
                .json({ chat_id: '123456789' }),
            200,
        )
        assert.equal(igual.body().version, 2)
        assert.lengthOf(await cambios(clienteId, req2), 0)

        // otro chat (grupo, negativo) reemplaza
        const req3 = unico('req')
        await estado(
            client
                .post(`/api/v1/clientes/${clienteId}/vincular-telegram`)
                .bearerToken(token)
                .header('X-Request-Id', req3)
                .json({ chat_id: '-100200300' }),
            200,
        )
        assert.deepEqual(await cambios(clienteId, req3), [
            { campo: 'telegram_chat_id', antes: '123456789', despues: '-100200300' },
        ])

        const req4 = unico('req')
        const sin = await estado(
            client
                .post(`/api/v1/clientes/${clienteId}/desvincular-telegram`)
                .bearerToken(token)
                .header('X-Request-Id', req4),
            200,
        )
        assert.isNull(sin.body().telegram_chat_id)
        assert.deepEqual(await cambios(clienteId, req4), [
            { campo: 'telegram_chat_id', antes: '-100200300', despues: null },
        ])
        // desvincular de nuevo es un no-op
        await estado(
            client.post(`/api/v1/clientes/${clienteId}/desvincular-telegram`).bearerToken(token),
            200,
        )
    })

    test('422 con chat id inválido, 404 sin cliente, 403 sin permiso; el bot llama la acción directo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clienteId = await crearClienteFila()
        const invalido = await estado(
            client
                .post(`/api/v1/clientes/${clienteId}/vincular-telegram`)
                .bearerToken(token)
                .json({ chat_id: 'abc' }),
            422,
        )
        assert.equal(invalido.body().errors[0].field, 'chat_id')
        await estado(
            client
                .post('/api/v1/clientes/999999999/vincular-telegram')
                .bearerToken(token)
                .json({ chat_id: '1' }),
            404,
        )

        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post(`/api/v1/clientes/${clienteId}/vincular-telegram`)
                .bearerToken(cajero.token)
                .json({ chat_id: '1' }),
            403,
        )
        const tecnico = await usuarioConRoles(['tecnico'])
        await estado(
            client.post(`/api/v1/clientes/${clienteId}/desvincular-telegram`).bearerToken(tecnico.token),
            403,
        )

        // canal del bot: la acción valida el formato aunque no pase por VineJS
        const ctx = { ...contextoPrueba(), canal: 'webhook' as const }
        await assert.rejects(() =>
            new VincularTelegramCliente().execute({ id: clienteId, chat_id: '12a' }, ctx),
        )
        const cliente = await new VincularTelegramCliente().execute({ id: clienteId, chat_id: '555' }, ctx)
        assert.equal(cliente.telegram_chat_id, '555')
    })
})
