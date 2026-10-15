import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearCliente } from '#tests/notify/ayudas_notify'

test.group('notify · rutas', () => {
    test('lista las plantillas sembradas por evento y canal', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const respuesta = await estado(
            client.get('/api/v1/notificaciones/plantillas').bearerToken(token),
            200,
        )
        const plantillas = respuesta.body() as Array<{ evento: string; canal: string; version: number }>
        const claves = plantillas.map((p) => `${p.evento}/${p.canal}`)
        for (const evento of [
            'factura.emitida',
            'factura.vencida',
            'servicio.estado_cambiado',
            'pago.registrado',
        ]) {
            assert.include(claves, `${evento}/correo`)
            assert.include(claves, `${evento}/telegram`)
        }
    })

    test('edita una plantilla con version, audita el cambio y rechaza Mustache inválido o versión vieja', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const evento = unico('prueba.evento')
        const [plantilla] = (await db
            .table('notify.plantillas')
            .insert({ evento, canal: 'correo', asunto: 'A', cuerpo: 'Hola' })
            .returning(['id', 'version'])) as Array<{ id: number; version: number }>
        const ruta = `/api/v1/notificaciones/plantillas/${plantilla!.id}`

        const editada = await estado(
            client
                .put(ruta)
                .bearerToken(token)
                .json({ version: 1, cuerpo: 'Hola {{cliente.nombre}}', activa: false }),
            200,
        )
        assert.containsSubset(editada.body(), {
            id: plantilla!.id,
            cuerpo: 'Hola {{cliente.nombre}}',
            activa: false,
            asunto: 'A',
            version: 2,
        })

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'plantilla_notificacion', entidad_id: plantilla!.id })
            .orderBy('campo')
        assert.deepEqual(
            cambios.map((c) => [c.campo, c.antes, c.despues, c.actor_id]),
            [
                ['activa', true, false, usuario.id],
                ['cuerpo', 'Hola', 'Hola {{cliente.nombre}}', usuario.id],
            ],
        )

        const invalida = await estado(
            client.put(ruta).bearerToken(token).json({ version: 2, cuerpo: '{{#a}}sin cerrar' }),
            422,
        )
        assert.equal(invalida.body().errors[0].field, 'cuerpo')
        assert.equal(invalida.body().errors[0].rule, 'mustache')

        await estado(client.put(ruta).bearerToken(token).json({ version: 1, asunto: 'B' }), 409)
    })

    test('lista envíos por cliente con paginación; cajero no tiene permiso', async ({ client, assert }) => {
        const clienteId = await crearCliente()
        await db.table('notify.envios').multiInsert(
            [1, 2, 3].map((n) => ({
                origen: `prueba:${clienteId}:${n}`,
                evento: 'factura.emitida',
                cliente_id: clienteId,
                canal: 'correo',
                destino: 'x@prueba.local',
                cuerpo: `mensaje ${n}`,
            })),
        )
        const { token } = await usuarioConRoles(['soporte'])

        const primera = await estado(
            client
                .get('/api/v1/notificaciones/envios')
                .qs({ cliente_id: clienteId, limit: 2 })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(primera.body().data, 2)
        assert.isString(primera.body().nextCursor)
        assert.equal(primera.body().data[0].cuerpo, 'mensaje 3')

        const segunda = await estado(
            client
                .get('/api/v1/notificaciones/envios')
                .qs({ cliente_id: clienteId, limit: 2, cursor: primera.body().nextCursor })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(segunda.body().data, 1)
        assert.isNull(segunda.body().nextCursor)

        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/notificaciones/envios').bearerToken(cajero.token), 403)
    })
})
