import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import AprovisionarServicio from '#integraciones/equipos/actions/aprovisionar_servicio'
import { capacidadesDe } from '#core/tipos_servicio'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, crearRouterFila } from '#tests/core/fabricas'

/**
 * Plan v3, lote T1 (`contratos/tipos-servicio.md`): tipo de servicio de los servicios, sus eventos y las
 * operaciones que no aplican a un servicio sin router (cable).
 */

async function eventos(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload }))
}

/**
 * Servicio de cable: sin router. Fila directa (el alta de cable llega en T2); conserva las credenciales
 * porque el CHECK `servicios_credenciales_por_tipo` todavía las pide.
 */
async function servicioCable(estadoServicio = 'pendiente_instalacion') {
    const planCable = await crearPlanFila({
        tipo_servicio: 'cable',
        componentes: '{cable}',
        bajada_kbps: null,
        subida_kbps: null,
    })
    const clienteId = await crearClienteFila()
    const [fila] = (await db
        .table('core.servicios')
        .insert({
            cliente_id: clienteId,
            router_id: null,
            plan_id: planCable,
            tipo_servicio: 'cable',
            user_ppp: unico('cable'),
            pass_ppp: 'cifrada',
            estado: estadoServicio,
            ...(estadoServicio === 'pendiente_instalacion' ? { instalado_en: null } : {}),
        })
        .returning('id')) as Array<{ id: number }>
    return { id: fila!.id, planCable }
}

test.group('Tipos de servicio · capacidades', () => {
    test('tabla de capacidades de los cuatro tipos', ({ assert }) => {
        assert.deepEqual(capacidadesDe('internet'), {
            requiereRouter: true,
            requiereVelocidad: true,
            admiteLimitado: true,
            componentes: ['internet'],
            corteSmartolt: false,
        })
        assert.containsSubset(capacidadesDe('cable'), {
            requiereRouter: false,
            requiereVelocidad: false,
            admiteLimitado: false,
            corteSmartolt: true,
        })
        // IPTV nunca se limita: solo se corta o se activa
        assert.containsSubset(capacidadesDe('iptv'), {
            requiereRouter: true,
            requiereVelocidad: true,
            admiteLimitado: false,
            corteSmartolt: false,
        })
        // mixto: router siempre (tiene internet o IPTV); limitado solo con internet; SmartOLT solo con cable
        assert.containsSubset(capacidadesDe('mixto', ['internet', 'cable']), {
            requiereRouter: true,
            admiteLimitado: true,
            corteSmartolt: true,
        })
        assert.containsSubset(capacidadesDe('mixto', ['cable', 'iptv']), {
            requiereRouter: true,
            admiteLimitado: false,
            corteSmartolt: true,
        })
        assert.containsSubset(capacidadesDe('mixto', ['internet', 'iptv']), {
            admiteLimitado: true,
            corteSmartolt: false,
        })
    })
})

test.group('Servicios · tipo de servicio', () => {
    test('todo servicio existente es internet y GET trae tipo_servicio y componentes', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const clienteId = await crearClienteFila()
        const planId = await crearPlanFila()
        const [fila] = (await db
            .table('core.servicios')
            .insert({
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                user_ppp: unico('p'),
                pass_ppp: 'x',
            })
            .returning('id')) as Array<{ id: number }>
        const visto = await estado(client.get(`/api/v1/servicios/${fila!.id}`).bearerToken(token), 200)
        assert.containsSubset(visto.body(), {
            tipo_servicio: 'internet',
            componentes: ['internet'],
            puntos: null,
        })
        const lista = await estado(
            client.get('/api/v1/servicios').qs({ cliente_id: clienteId }).bearerToken(token),
            200,
        )
        assert.containsSubset(lista.body().data[0], { tipo_servicio: 'internet', componentes: ['internet'] })
    })

    test('alta con plan IPTV: tipo del plan, componentes y servicio.creado con tipo_servicio y componentes', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila({
            tipo_servicio: 'iptv',
            componentes: '{iptv}',
            bajada_limitada_kbps: 1024,
            subida_limitada_kbps: 512,
        })
        const clienteId = await crearClienteFila()
        const requestId = unico('req')
        const creado = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('X-Request-Id', requestId).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                puntos: 3,
            }),
            201,
        )
        assert.containsSubset(creado.body(), { tipo_servicio: 'iptv', componentes: ['iptv'], puntos: 3 })
        const evs = await eventos(requestId)
        const evento = evs.find((e) => e.evento === 'servicio.creado')!
        assert.containsSubset(evento.payload, {
            servicio_id: creado.body().id,
            router_id: routerId,
            plan_id: planId,
            tipo_servicio: 'iptv',
            componentes: ['iptv'],
        })
    })

    test('tipo distinto al del plan: 422 y nada se crea', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const rechazo = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_servicio: 'iptv',
            }),
            422,
        )
        assert.deepEqual(
            rechazo.body().errors.map((e: { field: string; rule: string }) => [e.field, e.rule]),
            [['tipo_servicio', 'tipo_servicio_distinto']],
        )
        const filas = await db.from('core.servicios').where('cliente_id', clienteId).count('* as n')
        assert.equal(Number(filas[0]!.n), 0)
        // y la base lo exige aunque se salte la API: el trigger responde check_violation
        await assert.rejects(
            () =>
                db.table('core.servicios').insert({
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    tipo_servicio: 'iptv',
                    user_ppp: unico('p'),
                    pass_ppp: 'x',
                }),
            /no coincide con el del plan/,
        )
    })

    test('el alta de cable por la API llega en T2: 422 alta_cable_pendiente sin efectos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const routerId = await crearRouterFila()
        const planCable = await crearPlanFila({
            tipo_servicio: 'cable',
            componentes: '{cable}',
            bajada_kbps: null,
            subida_kbps: null,
        })
        const clienteId = await crearClienteFila()
        const rechazo = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planCable,
            }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:alta_cable_pendiente')
    })

    test('filtro tipo_servicio en /servicios', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const planIptv = await crearPlanFila({ tipo_servicio: 'iptv', componentes: '{iptv}' })
        const planInternet = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const insertar = async (plan_id: number, tipo_servicio: string) =>
            Number(
                (
                    (await db
                        .table('core.servicios')
                        .insert({
                            cliente_id: clienteId,
                            router_id: routerId,
                            plan_id,
                            tipo_servicio,
                            user_ppp: unico('p'),
                            pass_ppp: 'x',
                        })
                        .returning('id')) as Array<{ id: number }>
                )[0]!.id,
            )
        const iptv = await insertar(planIptv, 'iptv')
        const internet = await insertar(planInternet, 'internet')
        const { cable } = await servicioCable().then((c) => ({ cable: c.id }))
        const ids = async (tipo: string) => {
            const respuesta = await estado(
                client.get('/api/v1/servicios').qs({ tipo_servicio: tipo, limit: 200 }).bearerToken(token),
                200,
            )
            return respuesta.body().data.map((x: { id: number }) => x.id) as number[]
        }
        const iptvs = await ids('iptv')
        assert.include(iptvs, iptv)
        assert.notInclude(iptvs, internet)
        assert.include(await ids('internet'), internet)
        const cables = await ids('cable')
        assert.include(cables, cable)
        assert.notInclude(cables, iptv)
        // el alcance por router no ve el cable (no tiene router)
        const sin = await ids('mixto')
        assert.notInclude(sin, cable)
    })

    test('cambiar a un plan de otro tipo exige confirmar tipo_servicio y emite servicio.config_cambiada con tipo_servicio', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId } = await crearEscenarioRouter()
        const planInternet = await crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512 })
        const planIptv = await crearPlanFila({
            tipo_servicio: 'iptv',
            componentes: '{iptv}',
            bajada_limitada_kbps: 1024,
            subida_limitada_kbps: 512,
        })
        const clienteId = await crearClienteFila()
        const creado = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planInternet,
            }),
            201,
        )
        const id = creado.body().id

        // sin confirmar el tipo: 422 y nada cambia
        const sin = await estado(
            client.put(`/api/v1/servicios/${id}`).bearerToken(token).json({ version: 1, plan_id: planIptv }),
            422,
        )
        assert.equal(sin.body().errors[0].rule, 'tipo_servicio_distinto')
        const fila = await db.from('core.servicios').where('id', id).firstOrFail()
        assert.equal(fila.plan_id, Number(planInternet))
        assert.equal(fila.tipo_servicio, 'internet')

        const requestId = unico('req')
        const editado = await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, plan_id: planIptv, tipo_servicio: 'iptv' }),
            200,
        )
        assert.containsSubset(editado.body(), {
            tipo_servicio: 'iptv',
            componentes: ['iptv'],
            plan_id: planIptv,
        })
        const emitidos = await eventos(requestId)
        const config = emitidos.find((e) => e.evento === 'servicio.config_cambiada')!
        assert.sameMembers(config.payload.campos, ['plan', 'tipo_servicio'])

        // tipo igual al actual pero distinto al del plan: 422
        await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .json({ version: 2, tipo_servicio: 'internet' }),
            422,
        )
    })
})

test.group('Servicios · cable sin router (tipo_sin_router)', () => {
    async function sinEfectos(
        assert: { equal: (a: unknown, b: unknown) => void },
        id: number,
        antes: { version: number; plan_id: number },
    ) {
        const fila = await db.from('core.servicios').where('id', id).firstOrFail()
        assert.equal(fila.version, antes.version)
        assert.equal(Number(fila.plan_id), antes.plan_id)
        assert.equal(fila.router_id, null)
        const outbox = await db
            .from('audit.outbox')
            .whereRaw(`payload->>'servicio_id' = ?`, [String(id)])
            .count('* as n')
        assert.equal(Number(outbox[0]!.n), 0)
        const ips = await db.from('network.ipv4_asignaciones').where('servicio_id', id).count('* as n')
        assert.equal(Number(ips[0]!.n), 0)
    }

    test('reservar-ip responde 422 tipo_sin_router, sin efectos', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { id, planCable } = await servicioCable()
        const antes = { version: 1, plan_id: Number(planCable) }
        const rechazo = await estado(
            client
                .post(`/api/v1/servicios/${id}/reservar-ip`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('k'))
                .json({ origen_tipo: 'panel', origen_id: unico('o') }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:tipo_sin_router')
        await sinEfectos(assert, id, antes)
    })

    test('cambiar-plan responde 422 tipo_sin_router, sin efectos', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { id, planCable } = await servicioCable()
        const otroPlan = await crearPlanFila({
            tipo_servicio: 'cable',
            componentes: '{cable}',
            bajada_kbps: null,
            subida_kbps: null,
        })
        const rechazo = await estado(
            client
                .post(`/api/v1/servicios/${id}/cambiar-plan`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('k'))
                .json({
                    plan_id: otroPlan,
                    motivo: 'mas_velocidad',
                    origen_tipo: 'panel',
                    origen_id: unico('o'),
                }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:tipo_sin_router')
        await sinEfectos(assert, id, { version: 1, plan_id: Number(planCable) })
    })

    test('aprovisionar responde 422 tipo_sin_router, sin efectos', async ({ assert }) => {
        const { id, planCable } = await servicioCable()
        await assert.rejects(
            () =>
                new AprovisionarServicio().execute(
                    { servicio_id: id, equipo: { tipo: 'ont', serie: unico('ONT') } },
                    contextoPrueba(),
                ),
            /no usa router/,
        )
        await sinEfectos(assert, id, { version: 1, plan_id: Number(planCable) })
        const aprov = await db
            .from('integraciones.aprovisionamientos')
            .where('servicio_id', id)
            .count('* as n')
        assert.equal(Number(aprov[0]!.n), 0)
    })

    test('editar un servicio de cable también responde 422 tipo_sin_router (la edición sin router llega en T2)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { id, planCable } = await servicioCable('activo')
        const rechazo = await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .json({ version: 1, direccion: 'Zona 3' }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:tipo_sin_router')
        await sinEfectos(assert, id, { version: 1, plan_id: Number(planCable) })
    })

    test('el servicio de cable se lee con router_id null y su plan sin velocidad', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { id } = await servicioCable()
        const visto = await estado(client.get(`/api/v1/servicios/${id}`).bearerToken(token), 200)
        assert.containsSubset(visto.body(), {
            router_id: null,
            tipo_servicio: 'cable',
            componentes: ['cable'],
        })
        const config = await estado(
            client.get(`/api/v1/servicios/${id}/configuracion-efectiva`).bearerToken(token),
            200,
        )
        assert.equal(config.body().plan.rate_limit, '')
    })
})
