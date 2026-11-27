import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearPlanFila, crearRouterFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Plan v3, lote T1 (`contratos/tipos-servicio.md` §2): tipo de servicio de los planes.
 */

function cuerpoPlan(extra: Record<string, unknown> = {}) {
    return {
        nombre: unico('Plan T1'),
        precio: '300.00',
        bajada_kbps: 20480,
        subida_kbps: 5120,
        bajada_limitada_kbps: 2048,
        subida_limitada_kbps: 1024,
        ...extra,
    }
}

function camposConError(respuesta: { body(): { errors?: Array<{ field: string }> } }): string[] {
    return (respuesta.body().errors ?? []).map((e) => e.field)
}

test.group('Planes · tipo de servicio', () => {
    test('tras migrar, todo plan existente es internet con componentes {internet}', async ({ assert }) => {
        // fila directa, como los planes anteriores a la migración (sin las columnas nuevas)
        const id = await crearPlanFila()
        const fila = await db.from('network.planes').where('id', id).firstOrFail()
        assert.equal(fila.tipo_servicio, 'internet')
        assert.deepEqual(fila.componentes, ['internet'])
        assert.isNull(fila.precio_cable)
        assert.isNull(fila.precio_iptv)
    })

    test('plan sin tipo: internet; trae tipo_servicio, componentes y desglose en la API', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan()), 201)
        assert.containsSubset(creado.body(), {
            tipo_servicio: 'internet',
            componentes: ['internet'],
            precio_cable: null,
            precio_iptv: null,
        })
        const visto = await estado(client.get(`/api/v1/planes/${creado.body().id}`).bearerToken(token), 200)
        assert.equal(visto.body().tipo_servicio, 'internet')
    })

    test('plan de cable acepta velocidad nula; internet e IPTV no', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const sinVelocidad = { bajada_kbps: undefined, subida_kbps: undefined }
        const cable = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(
                    cuerpoPlan({
                        tipo_servicio: 'cable',
                        ...sinVelocidad,
                        bajada_limitada_kbps: undefined,
                        subida_limitada_kbps: undefined,
                    }),
                ),
            201,
        )
        assert.containsSubset(cable.body(), {
            tipo_servicio: 'cable',
            componentes: ['cable'],
            bajada_kbps: null,
            subida_kbps: null,
        })
        for (const tipo of ['internet', 'iptv']) {
            const rechazo = await estado(
                client
                    .post('/api/v1/planes')
                    .bearerToken(token)
                    .json(cuerpoPlan({ tipo_servicio: tipo, ...sinVelocidad })),
                422,
            )
            assert.include(camposConError(rechazo), 'bajada_kbps')
        }
        // IPTV con velocidad: normal
        const iptv = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo_servicio: 'iptv' })),
            201,
        )
        assert.deepEqual(iptv.body().componentes, ['iptv'])
    })

    test('un tipo simple no acepta componentes ajenos ni desglose de precios', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const ajeno = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo_servicio: 'iptv', componentes: ['internet'] })),
            422,
        )
        assert.include(camposConError(ajeno), 'componentes')
        const desglose = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ precio_cable: '50.00' })),
            422,
        )
        assert.include(camposConError(desglose), 'precio_cable')
    })

    test('plan mixto: dos o tres componentes y desglose menor que el precio habiendo internet', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const mixto = (extra: Record<string, unknown>) =>
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo_servicio: 'mixto', ...extra }))

        const uno = await estado(mixto({ componentes: ['internet'] }), 422)
        assert.include(camposConError(uno), 'componentes')
        const ninguno = await estado(mixto({}), 422)
        assert.include(camposConError(ninguno), 'componentes')
        const repetidos = await estado(mixto({ componentes: ['internet', 'internet'] }), 422)
        assert.include(camposConError(repetidos), 'componentes')

        // precio_cable + precio_iptv = precio habiendo internet: la línea de internet quedaría en 0
        const igual = await estado(
            mixto({
                componentes: ['internet', 'cable', 'iptv'],
                precio_cable: '200.00',
                precio_iptv: '100.00',
            }),
            422,
        )
        assert.include(camposConError(igual), 'precio_cable')
        const mayor = await estado(mixto({ componentes: ['internet', 'cable'], precio_cable: '300.01' }), 422)
        assert.include(camposConError(mayor), 'precio_cable')
        // un desglose de un componente que el plan no trae
        const ajeno = await estado(mixto({ componentes: ['internet', 'cable'], precio_iptv: '20.00' }), 422)
        assert.include(camposConError(ajeno), 'precio_iptv')

        const bueno = await estado(
            mixto({
                componentes: ['internet', 'cable', 'iptv'],
                precio_cable: '100.00',
                precio_iptv: '50.00',
            }),
            201,
        )
        assert.containsSubset(bueno.body(), {
            tipo_servicio: 'mixto',
            componentes: ['internet', 'cable', 'iptv'],
            precio_cable: '100.00',
            precio_iptv: '50.00',
        })
        // sin internet (cable + IPTV) el desglose puede cubrir todo el precio: IPTV es el resto
        await estado(
            mixto({ componentes: ['cable', 'iptv'], precio_cable: '120.00', precio_iptv: '180.00' }),
            201,
        )
        await estado(
            mixto({ componentes: ['cable', 'iptv'], precio_cable: '200.00', precio_iptv: '150.00' }),
            422,
        )
    })

    test('editar valida el plan resultante: el precio no puede dejar el desglose sin internet', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(
                    cuerpoPlan({
                        tipo_servicio: 'mixto',
                        componentes: ['internet', 'cable'],
                        precio_cable: '100.00',
                    }),
                ),
            201,
        )
        const id = creado.body().id
        const rechazo = await estado(
            client.put(`/api/v1/planes/${id}`).bearerToken(token).json({ version: 1, precio: '90.00' }),
            422,
        )
        assert.include(camposConError(rechazo), 'precio_cable')
        // sin cambios de tipo la edición normal sigue igual
        await estado(
            client.put(`/api/v1/planes/${id}`).bearerToken(token).json({ version: 1, precio: '350.00' }),
            200,
        )
    })

    test('filtros por tipo en /planes; por router no se ofrece el cable (422 tipo_sin_router)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const iptv = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo_servicio: 'iptv' })),
            201,
        )
        const cable = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(
                    cuerpoPlan({
                        tipo_servicio: 'cable',
                        bajada_limitada_kbps: undefined,
                        subida_limitada_kbps: undefined,
                    }),
                ),
            201,
        )
        const internetId = await crearPlanFila()

        const solo = async (tipo: string) => {
            const respuesta = await estado(
                client.get('/api/v1/planes').qs({ tipo_servicio: tipo, limit: 200 }).bearerToken(token),
                200,
            )
            return respuesta.body().data.map((p: { id: number }) => p.id) as number[]
        }
        const iptvs = await solo('iptv')
        assert.include(iptvs, iptv.body().id)
        assert.notInclude(iptvs, cable.body().id)
        assert.notInclude(iptvs, internetId)
        const cables = await solo('cable')
        assert.include(cables, cable.body().id)
        assert.notInclude(cables, iptv.body().id)
        assert.include(await solo('internet'), internetId)

        const routerId = await crearRouterFila()
        const rechazo = await estado(
            client
                .get('/api/v1/planes')
                .qs({ router_id: routerId, tipo_servicio: 'cable' })
                .bearerToken(token),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:tipo_sin_router')
        // por router, el cable nunca aparece aunque sea global
        const respuestaRouter = await estado(
            client.get('/api/v1/planes').qs({ router_id: routerId, limit: 200 }).bearerToken(token),
            200,
        )
        const porRouter = respuestaRouter.body().data.map((p: { id: number }) => p.id) as number[]
        assert.include(porRouter, iptv.body().id)
        assert.notInclude(porRouter, cable.body().id)
    })

    test('cambiar el tipo de un plan con servicios: cada servicio emite servicio.config_cambiada con tipo_servicio', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const s1 = await crearServicioFila({ cliente_id: clienteId, plan_id: planId })
        const s2 = await crearServicioFila({ cliente_id: clienteId, plan_id: planId })
        const otro = await crearServicioFila({ cliente_id: clienteId })
        const requestId = unico('req')

        const editado = await estado(
            client
                .put(`/api/v1/planes/${planId}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, tipo_servicio: 'iptv' }),
            200,
        )
        assert.containsSubset(editado.body(), { tipo_servicio: 'iptv', componentes: ['iptv'] })

        const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
        const configs = filas.filter((f) => f.evento === 'servicio.config_cambiada')
        assert.sameMembers(
            configs.map((f) => Number(f.payload.servicio_id)),
            [s1, s2],
        )
        for (const c of configs) assert.deepEqual(c.payload.campos, ['tipo_servicio'])
        const catalogo = filas.find((f) => f.evento === 'catalogo.cambiado')!
        assert.deepEqual(catalogo.payload.campos, ['tipo_servicio', 'componentes'])

        const tipos = await db
            .from('core.servicios')
            .whereIn('id', [s1, s2, otro])
            .select('id', 'tipo_servicio', 'version')
        for (const t of tipos) {
            assert.equal(t.tipo_servicio, Number(t.id) === otro ? 'internet' : 'iptv')
        }
        // el diff de cada servicio quedó en la auditoría
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s1, campo: 'tipo_servicio' })
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['internet', 'iptv'])
    })

    test('el tipo de un plan con servicios sin router no pasa a un tipo con router, y a cable llega en T2', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const servicio = await crearServicioFila({ cliente_id: clienteId, plan_id: planId })
        const aCable = await estado(
            client
                .put(`/api/v1/planes/${planId}`)
                .bearerToken(token)
                .json({ version: 1, tipo_servicio: 'cable', bajada_kbps: null, subida_kbps: null }),
            422,
        )
        assert.match(aCable.body().detail, /T2/)
        // sin efectos: nada cambió
        const fila = await db.from('core.servicios').where('id', servicio).firstOrFail()
        assert.equal(fila.tipo_servicio, 'internet')
        const plan = await db.from('network.planes').where('id', planId).firstOrFail()
        assert.equal(plan.tipo_servicio, 'internet')
    })
})
