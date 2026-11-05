import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearPlanFila, crearRouterFila } from '#tests/core/fabricas'

/** Cuerpo de una respuesta con el status esperado. */
async function cuerpo(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

/**
 * Modo de velocidad único por router (`contratos/control-velocidad.md` §11): no hay excepciones
 * nuevas por plan; las que existen se ven en la vista previa y se quitan con
 * `routers.unificar_control_velocidad`.
 */

const EXCEPCION = {
    pppoe: { aplicacion: 'arbol_pcq', padre: 'por_plan', tipo_cola: 'pcq' },
    ip_estatica: { aplicacion: 'arbol_pcq', padre: 'por_plan', tipo_cola: 'pcq' },
    dhcp_fija: { aplicacion: 'arbol_pcq', padre: 'por_plan', tipo_cola: 'pcq' },
}

async function conExcepcion(routerId: number) {
    const planId = await crearPlanFila()
    await db.table('network.planes_routers').insert({
        plan_id: planId,
        router_id: routerId,
        estrategia_velocidad: JSON.stringify(EXCEPCION),
    })
    return planId
}

test.group('Control de velocidad · modo único por router', (group) => {
    let admin: string
    group.setup(async () => {
        ;({ token: admin } = await usuarioConRoles(['admin']))
    })

    test('no se crean excepciones nuevas por plan (422 estrategia_por_router)', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const planId = await crearPlanFila()
        const r = await client
            .post(`/api/v1/planes/${planId}/routers/${routerId}/estrategia-velocidad`)
            .bearerToken(admin)
            .json({ estrategia_velocidad: EXCEPCION })
        r.assertStatus(422)
        assert.equal(r.body().errors[0].rule, 'estrategia_por_router')
        const vista = await client
            .post(`/api/v1/routers/${routerId}/vista-previa-estrategia`)
            .bearerToken(admin)
            .json({ planes: [{ plan_id: planId, estrategia_velocidad: EXCEPCION }] })
        vista.assertStatus(422)
        assert.equal(vista.body().errors[0].field, `planes.${planId}`)
        // null (ver cómo queda sin excepción) sigue valiendo
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/vista-previa-estrategia`)
                .bearerToken(admin)
                .json({ planes: [{ plan_id: planId, estrategia_velocidad: null }] }),
            200,
        )
    })

    test('vista previa lista las excepciones; unificar las quita con un evento por plan', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const a = await conExcepcion(routerId)
        const b = await conExcepcion(routerId)
        const sinExcepcion = await crearPlanFila()
        await db.table('network.planes_routers').insert({ plan_id: sinExcepcion, router_id: routerId })

        const vista = await cuerpo(
            client.get(`/api/v1/routers/${routerId}/vista-previa-unificar-velocidad`).bearerToken(admin),
            200,
        )
        assert.deepEqual(
            vista.planes.map((p: { plan_id: number }) => p.plan_id),
            [a, b].sort((x, y) => x - y),
        )
        const plan = vista.planes[0]
        assert.equal(plan.de.pppoe.aplicacion, 'arbol_pcq')
        assert.equal(plan.a.pppoe.aplicacion, 'radius_rate_limit')
        assert.includeMembers(plan.capas, ['aplicacion', 'tipo_cola'])
        assert.isTrue(vista.vista_previa.valida)

        // lo que se vio no coincide: 409
        const tarde = await client
            .post(`/api/v1/routers/${routerId}/unificar-control-velocidad`)
            .bearerToken(admin)
            .json({ planes: [a] })
        tarde.assertStatus(409)
        assert.equal(tarde.body().type.split(':').pop(), 'excepciones_cambiaron')

        // solo admin
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/unificar-control-velocidad`)
                .bearerToken(tecnico)
                .json({ planes: [a, b] }),
            403,
        )

        const r = await cuerpo(
            client
                .post(`/api/v1/routers/${routerId}/unificar-control-velocidad`)
                .bearerToken(admin)
                .json({ planes: [b, a], motivo: 'decisión del PM' }),
            200,
        )
        assert.deepEqual(
            r.planes,
            [a, b].sort((x, y) => x - y),
        )
        const filas = await db
            .from('network.planes_routers')
            .where('router_id', routerId)
            .whereIn('plan_id', [a, b])
        assert.isTrue(filas.every((f) => f.estrategia_velocidad === null))
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'router.estrategia_cambiada')
            .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId])
        assert.lengthOf(eventos, 2)
        for (const e of eventos) {
            assert.equal(e.payload.motivo, 'unificar')
            assert.isNull(e.payload.a)
            assert.includeMembers([a, b], [e.payload.plan_id])
        }
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'plan_router', campo: 'estrategia_velocidad' })
            .whereIn(
                'entidad_id',
                filas.map((f) => f.id),
            )
        assert.lengthOf(cambios, 2)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routers.unificar_control_velocidad', entidad_id: routerId })
            .first()
        assert.isNotNull(accion)

        // ya unificado: vista previa vacía y unificar [] no emite nada
        const vacia = await cuerpo(
            client.get(`/api/v1/routers/${routerId}/vista-previa-unificar-velocidad`).bearerToken(admin),
            200,
        )
        assert.deepEqual(vacia.planes, [])
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/unificar-control-velocidad`)
                .bearerToken(admin)
                .json({ planes: [] }),
            200,
        )
        assert.lengthOf(
            await db
                .from('audit.outbox')
                .where('evento', 'router.estrategia_cambiada')
                .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId]),
            2,
        )
    })
})
