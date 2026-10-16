import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, redUnica } from '#tests/core/fabricas'

/**
 * `POST /servicios` con `red_ipv4_id` (pedido de A4): asigna de esa red; 422 si no es del router,
 * si está llena o si la `ipv4` pedida no es de esa red.
 */

async function crearRed(routerId: number, cidr: string, tipo: 'estatico' | 'pool', gateway?: string) {
    const [fila] = (await db
        .table('network.redes_ipv4')
        .insert({ router_id: routerId, cidr, tipo, gateway: gateway ?? null })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

test.group('Servicios · alta con red_ipv4_id', () => {
    test('asigna de la red pedida aunque haya una red estatico con IPs libres', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId, base } = await crearEscenarioRouter()
        const cidrPool = redUnica()
        const basePool = cidrPool.replace('.0/24', '')
        const redPool = await crearRed(routerId, cidrPool, 'pool', `${basePool}.1`)
        const planId = await crearPlanFila()

        const enPool = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    red_ipv4_id: redPool,
                }),
            201,
        )
        assert.equal(enPool.body().ipv4, `${basePool}.2`)

        // sin red_ipv4_id sigue la regla actual: primero las redes estatico
        const normal = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ cliente_id: await crearClienteFila(), router_id: routerId, plan_id: planId }),
            201,
        )
        assert.equal(normal.body().ipv4, `${base}.2`)

        // ipv4 + red_ipv4_id: la IP debe ser de esa red
        const fuera = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    red_ipv4_id: redPool,
                    ipv4: `${base}.40`,
                }),
            422,
        )
        assert.equal(fuera.body().errors[0].field, 'ipv4')
        const dentro = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    red_ipv4_id: redPool,
                    ipv4: `${basePool}.40`,
                }),
            201,
        )
        assert.equal(dentro.body().ipv4, `${basePool}.40`)
    })

    test('422 en red_ipv4_id si la red es de otro router, no existe o está llena', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await crearEscenarioRouter()
        const b = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const redDeB = (await db.from('network.redes_ipv4').where('router_id', b.routerId).firstOrFail()) as {
            id: number
        }

        const otro = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: a.routerId,
                    plan_id: planId,
                    red_ipv4_id: redDeB.id,
                }),
            422,
        )
        assert.equal(otro.body().errors[0].field, 'red_ipv4_id')
        assert.include(otro.body().detail, 'no es del router')

        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: a.routerId,
                    plan_id: planId,
                    red_ipv4_id: 999999999,
                }),
            422,
        )

        // /30 sin gateway: dos hosts (.1 y .2)
        const chica = redUnica().replace('.0/24', '.0/30')
        const redChica = await crearRed(a.routerId, chica, 'pool')
        const pedir = async (status: number) =>
            estado(
                client
                    .post('/api/v1/servicios')
                    .bearerToken(token)
                    .json({
                        cliente_id: await crearClienteFila(),
                        router_id: a.routerId,
                        plan_id: planId,
                        red_ipv4_id: redChica,
                    }),
                status,
            )
        await pedir(201)
        await pedir(201)
        const llena = await pedir(422)
        assert.equal(llena.body().errors[0].field, 'red_ipv4_id')
        assert.equal(llena.body().errors[0].rule, 'llena')
    })
})
