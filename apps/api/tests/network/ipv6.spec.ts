import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { aBigInt, deBigInt, indiceEnPool, subprefijo } from '#network/ipv6'
import { reservarPrefijo } from '#network/ipam_v6'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { bloqueV6Unico, crearClienteFila, crearRouterFila, crearServicioFila } from '#tests/core/fabricas'

test.group('IPv6 · aritmética', () => {
    test('parsea y formatea direcciones', ({ assert }) => {
        assert.equal(aBigInt('::1'), 1n)
        assert.equal(aBigInt('2001:db8::'), 0x20010db8n << 96n)
        assert.equal(deBigInt(aBigInt('2001:db8:0:0:1::5')), '2001:db8:0:0:1:0:0:5')
        assert.equal(aBigInt('::ffff:10.0.0.1'), (0xffffn << 32n) | 0x0a000001n)
        assert.throws(() => aBigInt('2001:::1'))
    })

    test('subprefijos e índices', ({ assert }) => {
        assert.equal(subprefijo('2001:db8:100::/40', 56, 0n), '2001:db8:100:0:0:0:0:0/56')
        assert.equal(subprefijo('2001:db8:100::/40', 56, 3n), '2001:db8:100:300:0:0:0:0/56')
        assert.equal(indiceEnPool('2001:db8:100::/40', '2001:db8:100:300::/56', 56), 3n)
        assert.equal(indiceEnPool('2001:db8:100::/40', '2001:db8:100:300::/60', 56), 3n)
    })
})

test.group('IPv6 · bloques, pools y reservas', () => {
    test('crear bloque y pools por API; validaciones y traslapes', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await crearRouterFila()
        const bloque = bloqueV6Unico()
        const raiz = bloque.replace('00::/40', '')

        const b = await estado(
            client
                .post(`/api/v1/routers/${routerId}/ipv6-bloques`)
                .bearerToken(token)
                .json({ prefijo: bloque }),
            201,
        )
        assert.containsSubset(b.body(), { router_id: routerId, prefijo: bloque.replace('::/40', '::/40') })
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/ipv6-bloques`)
                .bearerToken(token)
                .json({ prefijo: bloque }),
            409,
        )

        const pool = await estado(
            client
                .post(`/api/v1/ipv6-bloques/${b.body().id}/pools`)
                .bearerToken(token)
                .json({
                    prefijo: `${raiz}10::/44`,
                    tipo: 'delegacion',
                    tamano_entrega: 56,
                    nombre_en_router: 'pd',
                }),
            201,
        )
        assert.containsSubset(pool.body(), { tipo: 'delegacion', tamano_entrega: 56, nombre_en_router: 'pd' })

        const enlaceMal = await estado(
            client
                .post(`/api/v1/ipv6-bloques/${b.body().id}/pools`)
                .bearerToken(token)
                .json({ prefijo: `${raiz}00::/48`, tipo: 'enlace', tamano_entrega: 56 }),
            422,
        )
        assert.equal(enlaceMal.body().errors[0].field, 'tamano_entrega')
        await estado(
            client
                .post(`/api/v1/ipv6-bloques/${b.body().id}/pools`)
                .bearerToken(token)
                .json({ prefijo: '2001:db8:ff00::/48', tipo: 'enlace', tamano_entrega: 64 }),
            422,
        )
        await estado(
            client
                .post(`/api/v1/ipv6-bloques/${b.body().id}/pools`)
                .bearerToken(token)
                .json({ prefijo: `${raiz}10::/48`, tipo: 'delegacion', tamano_entrega: 56 }),
            409,
        )
        const pools = await estado(
            client.get(`/api/v1/ipv6-bloques/${b.body().id}/pools`).bearerToken(token),
            200,
        )
        assert.lengthOf(pools.body(), 1)
        const bloques = await estado(
            client.get(`/api/v1/routers/${routerId}/ipv6-bloques`).bearerToken(token),
            200,
        )
        assert.lengthOf(bloques.body(), 1)
    })

    test('reservarPrefijo salta prefijos ocupados por estáticos y respeta la capacidad', async ({
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const bloque = bloqueV6Unico()
        const raiz = bloque.replace('00::/40', '')
        const [b] = (await db
            .table('network.ipv6_bloques')
            .insert({ router_id: routerId, prefijo: bloque })
            .returning('id')) as Array<{ id: number }>
        // pool chico: /54 → cuatro /56
        await db
            .table('network.ipv6_pools')
            .insert({ bloque_id: b!.id, prefijo: `${raiz}00::/54`, tipo: 'delegacion', tamano_entrega: 56 })
        const clienteId = await crearClienteFila()
        const servicios: number[] = []
        for (let i = 0; i < 5; i++) {
            servicios.push(await crearServicioFila({ cliente_id: clienteId, router_id: routerId }))
        }
        // un estático ocupa el segundo /56
        await db
            .table('network.ipv6_asignaciones')
            .insert({ servicio_id: servicios[4], prefijo: `${raiz}00:100::/56`, tipo: 'delegacion' })

        const obtenidos: string[] = []
        await db.transaction(async (trx) => {
            for (const id of servicios.slice(0, 3)) {
                obtenidos.push(
                    await reservarPrefijo(trx, { servicioId: id!, routerId, tipo: 'delegacion', tamano: 56 }),
                )
            }
            await assert.rejects(
                () =>
                    reservarPrefijo(trx, {
                        servicioId: servicios[3]!,
                        routerId,
                        tipo: 'delegacion',
                        tamano: 56,
                    }),
                /no tienen prefijos libres/,
            )
        })
        assert.deepEqual(obtenidos, [`${raiz}00::/56`, `${raiz}00:200::/56`, `${raiz}00:300::/56`])
    })
})
