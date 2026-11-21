import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { conActor, tokenIris } from '#tests/core/ayudas_iris_0100'

/**
 * Planes aplicables y cambio de plan de un pendiente (contrato Iris 0.10.0 §3.4.5, A40).
 */

async function pendiente(client: any, token: string, planId: number, routerId: number) {
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila({ codigo_externo: `iris:prospecto:${randomUUID()}` }),
                router_id: routerId,
                plan_id: planId,
                estado_inicial: 'pendiente_instalacion',
            }),
        201,
    )
    return r.body() as Record<string, any>
}

test.group('Cambio de plan de un pendiente (A40)', () => {
    test('GET /planes?router_id=&modo= solo trae los aplicables, con modo y routers', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId } = await crearEscenarioRouter()
        const otro = await crearEscenarioRouter()
        const residencial = await crearPlanFila()
        const empresarial = await crearPlanFila({ tipo: 'dedicado' })
        const inactivo = await crearPlanFila({ activo: false })
        const deOtroRouter = await crearPlanFila({ global: false })
        await db.table('network.planes_routers').insert({ plan_id: deOtroRouter, router_id: otro.routerId })
        const delRouter = await crearPlanFila({ global: false })
        await db.table('network.planes_routers').insert({ plan_id: delRouter, router_id: routerId })

        const r = await estado(
            client
                .get('/api/v1/planes')
                .qs({ router_id: routerId, modo: 'residencial', limit: 200 })
                .bearerToken(token),
            200,
        )
        const ids = r.body().data.map((p: any) => p.id)
        assert.includeMembers(ids, [residencial, delRouter])
        assert.notIncludeMembers(ids, [empresarial, inactivo, deOtroRouter])
        const fila = r.body().data.find((p: any) => p.id === delRouter)
        assert.equal(fila.modo, 'residencial')
        assert.deepEqual(fila.routers, [routerId])
        const emp = await estado(
            client
                .get('/api/v1/planes')
                .qs({ router_id: routerId, modo: 'empresarial', limit: 200 })
                .bearerToken(token),
            200,
        )
        assert.include(
            emp.body().data.map((p: any) => p.id),
            empresarial,
        )
    })

    test('cambia el plan con motivo y emite config_cambiada con la orden; 422 de plan y de estado', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId } = await crearEscenarioRouter()
        const planA = await crearPlanFila()
        const planB = await crearPlanFila({ precio: '250.00' })
        const planEmpresa = await crearPlanFila({ tipo: 'empresarial' })
        const s = await pendiente(client, token, planA, routerId)
        const cambiar = (cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${s.id}/cambiar-plan`)
                .bearerToken(token)
                .json({ origen_tipo: 'iris_orden', origen_id: '44', ...cuerpo })

        const sinTexto = await cambiar({ plan_id: planB, motivo: 'otro' })
        sinTexto.assertStatus(422)
        const otroModo = await cambiar({ plan_id: planEmpresa, motivo: 'mas_velocidad' })
        otroModo.assertStatus(422)
        assert.equal(otroModo.body().type, 'urn:argosisp:problema:plan_no_permitido')
        const viejo = await cambiar({ plan_id: planB, motivo: 'mas_velocidad', version: s.version + 5 })
        viejo.assertStatus(409)

        const r = await estado(cambiar({ plan_id: planB, motivo: 'mas_velocidad' }), 200)
        assert.equal(r.body().plan_id, planB)
        assert.equal(r.body().precio_mensual, '250.00')
        assert.isNull(r.body().ipv4)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'servicio.config_cambiada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.id])
            .first()
        assert.includeMembers(evento.payload.campos, ['plan', 'precio'])
        assert.equal(evento.payload.origen_tipo, 'iris_orden')
        assert.equal(evento.payload.origen_id, '44')
        const facturas = await db.from('billing.facturas').where('servicio_id', s.id)
        assert.lengthOf(facturas, 0)

        await estado(
            client
                .post(`/api/v1/servicios/${s.id}/activar-instalacion`)
                .bearerToken(token)
                .header('Idempotency-Key', `prueba:${randomUUID()}`)
                .json({}),
            200,
        )
        const activo = await cambiar({ plan_id: planA, motivo: 'menos_velocidad' })
        activo.assertStatus(422)
        assert.equal(activo.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
    })

    test('activar responde 422 plan_no_permitido si el plan no está en el router final', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const plan = await crearPlanFila({ global: false })
        await db.table('network.planes_routers').insert({ plan_id: plan, router_id: routerId })
        const s = await pendiente(client, token, plan, routerId)
        await db.from('network.planes_routers').where({ plan_id: plan, router_id: routerId }).delete()
        const r = await client
            .post(`/api/v1/servicios/${s.id}/activar-instalacion`)
            .bearerToken(token)
            .header('Idempotency-Key', `prueba:${randomUUID()}`)
            .json({})
        r.assertStatus(422)
        assert.equal(r.body().type, 'urn:argosisp:problema:plan_no_permitido')
    })

    test('Iris: nunca el asistente', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId } = await crearEscenarioRouter()
        const s = await pendiente(client, token, await crearPlanFila(), routerId)
        const iris = await tokenIris()
        const r = await conActor(
            client.post(`/api/v1/servicios/${s.id}/cambiar-plan`).bearerToken(iris),
            'asistente_ia',
        ).json({
            plan_id: await crearPlanFila(),
            motivo: 'mas_velocidad',
            origen_tipo: 'iris_orden',
            origen_id: '1',
        })
        r.assertStatus(403)
        assert.equal(r.body().type, 'urn:argosisp:problema:actor_ia_no_permitido')
    })
})
