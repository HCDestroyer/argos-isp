import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import CrearCliente from '#core/actions/crear_cliente'
import CrearServicio from '#core/actions/crear_servicio'
import CrearRouter from '#network/actions/crear_router'
import CrearPlan from '#network/actions/crear_plan'
import { entidadPorExterno } from '#core/ids_externos'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearEscenarioRouter, ipUnica } from '#tests/core/fabricas'

/**
 * `core.ids_externos` y la opción `externo` de las altas que usa el importador (pedido de A6).
 */

test.group('Ids externos', () => {
    test('cliente, router, plan y servicio quedan vinculados a su id de origen', async ({ assert }) => {
        const sistema = 'mikrowisp'
        const ctx = contextoPrueba()
        const n = unico('mw')

        const cliente = await new CrearCliente().execute(
            { nombre: unico('Cliente'), externo: { sistema, id: `c-${n}` } },
            ctx,
        )
        const router = await new CrearRouter().execute(
            {
                nombre: unico('Router'),
                host: '192.0.2.5',
                nas_ip: ipUnica(),
                externo: { sistema, id: `r-${n}` },
            },
            ctx,
        )
        const plan = await new CrearPlan().execute(
            {
                nombre: unico('Plan'),
                precio: '100.00',
                bajada_kbps: 10000,
                subida_kbps: 2000,
                bajada_limitada_kbps: 1000,
                subida_limitada_kbps: 500,
                externo: { sistema, id: `p-${n}` },
            },
            ctx,
        )
        const esc = await crearEscenarioRouter()
        const servicio = await new CrearServicio().execute(
            {
                cliente_id: cliente.id,
                router_id: esc.routerId,
                plan_id: plan.id,
                externo: { sistema, id: `s-${n}` },
            },
            ctx,
        )

        assert.equal(await entidadPorExterno('cliente', { sistema, id: `c-${n}` }), cliente.id)
        assert.equal(await entidadPorExterno('router', { sistema, id: `r-${n}` }), router.id)
        assert.equal(await entidadPorExterno('plan', { sistema, id: `p-${n}` }), plan.id)
        assert.equal(await entidadPorExterno('servicio', { sistema, id: `s-${n}` }), servicio.id)
        assert.isNull(await entidadPorExterno('cliente', { sistema, id: 'no-existe' }))
        // el mismo id en otro tipo no choca
        assert.isNull(await entidadPorExterno('plan', { sistema, id: `c-${n}` }))

        // la entrada auditada lleva el id externo
        const accion = await db
            .from('audit.acciones')
            .where({ request_id: ctx.requestId, accion: 'clientes.crear' })
            .firstOrFail()
        assert.deepEqual(accion.entrada.externo, { sistema, id: `c-${n}` })
    })

    test('un id externo repetido responde 409 externo_duplicado y no crea nada', async ({ assert }) => {
        const externo = { sistema: 'mikrowisp', id: unico('dup') }
        const nombre = unico('Cliente')
        await new CrearCliente().execute({ nombre, externo }, contextoPrueba())
        await assert.rejects(
            () => new CrearCliente().execute({ nombre: `${nombre}-2`, externo }, contextoPrueba()),
            /ya está importado/,
        )
        const n = await db.from('core.clientes').where('nombre', `${nombre}-2`).count('* as n').first()
        assert.equal(Number(n.n), 0)
    })

    test('restricciones: una entidad tiene un solo id por sistema; sistema en minúsculas', async ({
        assert,
    }) => {
        const cliente = await new CrearCliente().execute(
            { nombre: unico('Cliente'), externo: { sistema: 'mikrowisp', id: unico('a') } },
            contextoPrueba(),
        )
        await assert.rejects(
            () =>
                db.table('core.ids_externos').insert({
                    sistema: 'mikrowisp',
                    entidad_tipo: 'cliente',
                    externo_id: unico('b'),
                    entidad_id: cliente.id,
                }),
            /ids_externos_entidad_unica/,
        )
        await assert.rejects(
            () =>
                db.table('core.ids_externos').insert({
                    sistema: 'MikroWisp',
                    entidad_tipo: 'cliente',
                    externo_id: unico('c'),
                    entidad_id: cliente.id,
                }),
            /check/,
        )
    })
})
