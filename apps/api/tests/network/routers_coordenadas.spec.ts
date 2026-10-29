import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { ipUnica } from '#tests/core/fabricas'

/**
 * Coordenadas del router (contrato Iris 0.3.1 §2.1, factibilidad desde el catálogo de routers):
 * columnas `latitud`/`longitud` en `network.routers`, `coordenadas: "lat,lng"` en la API.
 */

test.group('Iris 0.3.1 · coordenadas de routers', () => {
    test('crear, ver, listar, editar y quitar; mismo formato "lat,lng" que clientes; diff en audit.cambios', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({
                    nombre: unico('MK Norte'),
                    host: 'mk-norte.lab',
                    nas_ip: ipUnica(),
                    coordenadas: '14.6349, -90.5069',
                }),
            201,
        )
        const router = creado.body()
        assert.equal(router.coordenadas, '14.6349,-90.5069')
        const fila = await db.from('network.routers').where('id', router.id).firstOrFail()
        assert.equal(fila.latitud, '14.634900')
        assert.equal(fila.longitud, '-90.506900')

        // el catálogo que lee Iris (§2.1)
        const lista = await estado(client.get('/api/v1/routers?limit=100').bearerToken(token), 200)
        const enLista = (lista.body().data as Array<Record<string, unknown>>).find((r) => r.id === router.id)
        assert.equal(enLista?.coordenadas, '14.6349,-90.5069')

        // más de 6 decimales se redondea al guardar
        const editado = await estado(
            client
                .put(`/api/v1/routers/${router.id}`)
                .bearerToken(token)
                .json({ version: router.version, coordenadas: '-0.12345678,179.9' }),
            200,
        )
        assert.equal(editado.body().coordenadas, '-0.123457,179.9')

        // editar otra cosa no la toca
        const otro = await estado(
            client
                .put(`/api/v1/routers/${router.id}`)
                .bearerToken(token)
                .json({ version: editado.body().version, host: 'mk-norte-2.lab' }),
            200,
        )
        assert.equal(otro.body().coordenadas, '-0.123457,179.9')

        const quitado = await estado(
            client
                .put(`/api/v1/routers/${router.id}`)
                .bearerToken(token)
                .json({ version: otro.body().version, coordenadas: null }),
            200,
        )
        assert.isNull(quitado.body().coordenadas)
        const sinUbicar = await db.from('network.routers').where('id', router.id).firstOrFail()
        assert.isNull(sinUbicar.latitud)
        assert.isNull(sinUbicar.longitud)

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: router.id, campo: 'coordenadas' })
            .orderBy('id')
        assert.deepEqual(
            cambios.map((c) => [c.antes, c.despues]),
            [
                [null, '14.6349,-90.5069'],
                ['14.6349,-90.5069', '-0.123457,179.9'],
                ['-0.123457,179.9', null],
            ],
        )
    })

    test('fuera de rango o mal formadas: 422 en coordenadas; la base exige la pareja', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const coordenadas of [
            '90.1,10',
            '-91,10',
            '10,180.5',
            '10,-181',
            '14.6',
            'norte,sur',
            '14.6;-90.5',
        ]) {
            const r = await estado(
                client
                    .post('/api/v1/routers')
                    .bearerToken(token)
                    .json({
                        nombre: unico('MK Malo'),
                        host: 'x.lab',
                        nas_ip: ipUnica(),
                        coordenadas,
                    }),
                422,
            )
            assert.equal(r.body().errors[0].field, 'coordenadas', coordenadas)
            assert.include(r.body().errors[0].message, 'latitud')
        }
        // los bordes sí valen
        const borde = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({
                    nombre: unico('MK Borde'),
                    host: 'x.lab',
                    nas_ip: ipUnica(),
                    coordenadas: '-90,180',
                }),
            201,
        )
        assert.equal(borde.body().coordenadas, '-90,180')

        await assert.rejects(() =>
            db.from('network.routers').where('id', borde.body().id).update({ longitud: null }),
        )
        await assert.rejects(() =>
            db.from('network.routers').where('id', borde.body().id).update({ latitud: 95 }),
        )
    })
})
