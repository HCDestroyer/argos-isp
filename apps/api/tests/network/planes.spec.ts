import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearPlanFila, crearRouterFila } from '#tests/core/fabricas'

function cuerpoPlan(extra: Record<string, unknown> = {}) {
    return {
        nombre: unico('Plan 20M'),
        precio: '199.5',
        bajada_kbps: 20480,
        subida_kbps: 5120,
        bajada_limitada_kbps: 2048,
        subida_limitada_kbps: 1024,
        ...extra,
    }
}

test.group('Planes', () => {
    test('crear, ver, listar y editar con version; precio como string decimal', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan()), 201)
        const plan = creado.body()
        assert.containsSubset(plan, {
            precio: '199.50',
            dual_stack: 'ambos',
            tamano_prefijo_delegado: 56,
            global: true,
            activo: true,
            reuso: 1,
            version: 1,
        })
        await estado(client.get(`/api/v1/planes/${plan.id}`).bearerToken(token), 200)
        const lista = await estado(client.get('/api/v1/planes').qs({ limit: 200 }).bearerToken(token), 200)
        assert.isTrue(lista.body().data.some((p: { id: number }) => p.id === plan.id))

        const editado = await estado(
            client.put(`/api/v1/planes/${plan.id}`).bearerToken(token).json({ version: 1, precio: '210.00' }),
            200,
        )
        assert.equal(editado.body().precio, '210.00')
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'plan', entidad_id: plan.id, campo: 'precio' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['199.50', '210.00'])

        await estado(
            client.put(`/api/v1/planes/${plan.id}`).bearerToken(token).json({ version: 1, precio: '1.00' }),
            409,
        )
        await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ nombre: plan.nombre })),
            409,
        )
    })

    test('velocidad limitada obligatoria y > 0', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const respuesta = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ bajada_limitada_kbps: 0, subida_limitada_kbps: undefined })),
            422,
        )
        assert.sameMembers(
            respuesta.body().errors.map((e: { field: string }) => e.field),
            ['bajada_limitada_kbps', 'subida_limitada_kbps'],
        )
    })

    test('técnico ve planes pero no los crea', async ({ client }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        await estado(client.get('/api/v1/planes').bearerToken(token), 200)
        await estado(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan()), 403)
    })
})

test.group('Planes por router', () => {
    test('implementación por router y configuración efectiva', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r1 = await crearRouterFila()
        const r2 = await crearRouterFila()
        const global = await crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512 })
        const local = await crearPlanFila({
            global: false,
            bajada_limitada_kbps: 1024,
            subida_limitada_kbps: 512,
        })

        // sin implementación: el global usa la plantilla; el local no está disponible
        const efectivo = await obtenerImplementacionPlan(global, r1)
        assert.containsSubset(efectivo, {
            router_id: r1,
            implementacion: null,
            rate_limit: '5000k/20000k',
            rate_limit_limitado: '512k/1024k',
            profile_ppp: null,
        })
        await assert.rejects(() => obtenerImplementacionPlan(local, r1), /no está disponible/)

        const impl = await estado(
            client.put(`/api/v1/planes/${local}/routers/${r1}`).bearerToken(token).json({
                profile_ppp: 'argos-20M',
                pool_ipv4: 'pool-clientes',
                pool_ipv6_enlace: 'v6-enlace',
                pool_ipv6_delegacion: 'v6-pd',
                local_address: '10.255.0.1',
                rate_limit_override: '6M/24M 8M/30M 5M/20M 10/10',
            }),
            200,
        )
        assert.containsSubset(impl.body(), {
            plan_id: local,
            router_id: r1,
            profile_ppp: 'argos-20M',
            local_address: '10.255.0.1',
            version: 1,
        })

        const efectivoLocal = await obtenerImplementacionPlan(local, r1)
        assert.containsSubset(efectivoLocal, {
            rate_limit: '6M/24M 8M/30M 5M/20M 10/10',
            profile_ppp: 'argos-20M',
            pool_ipv4: 'pool-clientes',
            pool_ipv6_delegacion: 'v6-pd',
        })
        await assert.rejects(() => obtenerImplementacionPlan(local, r2), /no está disponible/)

        // editar la implementación exige version
        await estado(
            client.put(`/api/v1/planes/${local}/routers/${r1}`).bearerToken(token).json({ profile_ppp: 'x' }),
            422,
        )
        await estado(
            client
                .put(`/api/v1/planes/${local}/routers/${r1}`)
                .bearerToken(token)
                .json({ version: 1, rate_limit_override: null }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/planes/${local}/routers/${r1}`)
                .bearerToken(token)
                .json({ version: 1, profile_ppp: 'y' }),
            409,
        )
        const sinOverride = await obtenerImplementacionPlan(local, r1)
        assert.equal(sinOverride.rate_limit, '5000k/20000k')

        const enR1 = await estado(client.get(`/api/v1/routers/${r1}/planes`).bearerToken(token), 200)
        const ids = enR1.body().map((p: { id: number }) => p.id)
        assert.includeMembers(ids, [global, local])
        const enR2 = await estado(client.get(`/api/v1/routers/${r2}/planes`).bearerToken(token), 200)
        assert.include(
            enR2.body().map((p: { id: number }) => p.id),
            global,
        )
        assert.notInclude(
            enR2.body().map((p: { id: number }) => p.id),
            local,
        )

        const filtrados = await estado(
            client.get('/api/v1/planes').qs({ router_id: r2, limit: 200 }).bearerToken(token),
            200,
        )
        assert.notInclude(
            filtrados.body().data.map((p: { id: number }) => p.id),
            local,
        )

        const impls = await estado(client.get(`/api/v1/planes/${local}/routers`).bearerToken(token), 200)
        assert.deepEqual(
            impls.body().map((i: { router_id: number }) => i.router_id),
            [r1],
        )
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'planes.editar', entidad_tipo: 'plan_router' })
            .first()
        assert.isNotNull(accion)
    })

    test('planes inactivos no se ofrecen en el router', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await crearRouterFila()
        const inactivo = await crearPlanFila({ activo: false })
        const lista = await estado(client.get(`/api/v1/routers/${r}/planes`).bearerToken(token), 200)
        assert.notInclude(
            lista.body().map((p: { id: number }) => p.id),
            inactivo,
        )
    })
})
