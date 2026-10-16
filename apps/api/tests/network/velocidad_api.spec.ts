import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import { ConsumidorAaaCache } from '#core/consumidor_aaa'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearRouterFila,
    ipUnica,
} from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'

/**
 * Semana 2 · modelo de velocidad por API (`.claude/integration/contratos/velocidad.md`): campos
 * del plan, excepciones por router, control de velocidad del router, eventos
 * `plan.velocidad_cambiada` y `router.control_cambiado`, y el rate-limit completo en `aaa`.
 */

async function leer(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

function cuerpoPlan(extra: Record<string, unknown> = {}) {
    return {
        nombre: unico('Plan'),
        precio: '150.00',
        bajada_kbps: 20000,
        subida_kbps: 5000,
        bajada_limitada_kbps: 2048,
        subida_limitada_kbps: 1024,
        ...extra,
    }
}

async function eventos(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload }))
}

function campos(cuerpo: any): string[] {
    return (cuerpo.errors as Array<{ field: string }>).map((e) => e.field)
}

test.group('Velocidad · planes', () => {
    test('alta con los valores por defecto del contrato', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const plan = await leer(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan()), 201)
        assert.containsSubset(plan, {
            reuso: 1,
            garantizado_pct: null,
            rafaga_bajada_kbps: null,
            rafaga_subida_kbps: null,
            rafaga_umbral_pct: 75,
            rafaga_segundos: 16,
            prioridad: 8,
        })
    })

    test('422 por campo: CIR > MIR / reuso, ráfaga ≤ MIR, umbral, prioridad, reuso', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const crear = (extra: Record<string, unknown>) =>
            leer(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan(extra)), 422)

        assert.deepEqual(campos(await crear({ garantizado_pct: 100.5 })), ['garantizado_pct'])
        assert.deepEqual(campos(await crear({ reuso: 4, garantizado_pct: 30 })), ['garantizado_pct'])
        assert.deepEqual(campos(await crear({ rafaga_bajada_kbps: 20000 })), ['rafaga_bajada_kbps'])
        assert.deepEqual(campos(await crear({ rafaga_subida_kbps: 1000 })), ['rafaga_subida_kbps'])
        assert.deepEqual(campos(await crear({ rafaga_umbral_pct: 100 })), ['rafaga_umbral_pct'])
        assert.deepEqual(campos(await crear({ prioridad: 9 })), ['prioridad'])
        assert.deepEqual(campos(await crear({ prioridad: 0 })), ['prioridad'])
        assert.deepEqual(campos(await crear({ reuso: 65 })), ['reuso'])
    })

    test('editar velocidad: diff, plan.velocidad_cambiada y aaa:user:* con el rate-limit nuevo', async ({
        client,
        assert,
    }) => {
        await limpiarClavesAaa()
        const { token } = await usuarioConRoles(['admin'])
        const esc = await crearEscenarioRouter()
        const plan = await leer(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan()), 201)
        const servicio = await leer(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: esc.routerId,
                    plan_id: plan.id,
                }),
            201,
        )
        let cache = JSON.parse((await redis().get(claveAaa(servicio.user_ppp)))!)
        assert.equal(cache.plan.rate_limit, '5M/20M 0/0 0/0 0/0 8 5M/20M')

        const requestId = unico('req')
        const editado = await leer(
            client
                .put(`/api/v1/planes/${plan.id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: plan.version, reuso: 4, rafaga_bajada_kbps: 30000, prioridad: 2 }),
            200,
        )
        assert.containsSubset(editado, { reuso: 4, rafaga_bajada_kbps: 30000, prioridad: 2 })

        const evs = await eventos(requestId)
        assert.deepEqual(evs, [
            {
                evento: 'plan.velocidad_cambiada',
                payload: {
                    plan_id: plan.id,
                    router_id: null,
                    campos: ['reuso', 'rafaga_bajada_kbps', 'prioridad'],
                },
            },
        ])
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'plan', entidad_id: plan.id })
            .whereIn('campo', ['reuso', 'prioridad'])
            .whereRaw(`antes <> 'null'::jsonb`)
            .orderBy('campo')
            .select('campo', 'antes', 'despues')
        assert.deepEqual(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['prioridad', 8, 2],
                ['reuso', 1, 4],
            ],
        )

        cache = JSON.parse((await redis().get(claveAaa(servicio.user_ppp)))!)
        const esperado = '5M/20M 0/30M 0/15M 0/16 2 1250k/5M'
        assert.equal(cache.plan.rate_limit, esperado)
        assert.equal(cache.plan.rate_limit_limitado, '1024k/2048k 0/0 0/0 0/0 2 256k/512k')
        assert.equal(cache.plan.reuso, 4)
        const interno = await leer(
            client
                .get('/api/v1/internal/aaa/servicio')
                .qs({ user_ppp: servicio.user_ppp })
                .bearerToken(env.get('INTERNAL_TOKEN')),
            200,
        )
        assert.deepEqual(interno, cache)

        // editar algo que no es velocidad no emite el evento
        const otro = unico('req')
        await estado(
            client
                .put(`/api/v1/planes/${plan.id}`)
                .bearerToken(token)
                .header('X-Request-Id', otro)
                .json({ version: editado.version, precio: '175.00' }),
            200,
        )
        assert.deepEqual(await eventos(otro), [])
    })

    test('editar el plan valida antes del UPDATE (422, no 500) y contra las excepciones por router', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const plan = await leer(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ rafaga_bajada_kbps: 30000 })),
            201,
        )
        // bajar la ráfaga por debajo del MIR violaría el CHECK de la base: 422 por campo
        let cuerpo = await leer(
            client
                .put(`/api/v1/planes/${plan.id}`)
                .bearerToken(token)
                .json({ version: 1, bajada_kbps: 40000 }),
            422,
        )
        assert.deepEqual(campos(cuerpo), ['rafaga_bajada_kbps'])

        const routerId = await crearRouterFila()
        await estado(
            client
                .put(`/api/v1/planes/${plan.id}/routers/${routerId}`)
                .bearerToken(token)
                .json({ garantizado_pct: 50 }),
            200,
        )
        // reuso 4 en el plan deja la excepción del router (50 %) por encima de 100 / 4
        cuerpo = await leer(
            client.put(`/api/v1/planes/${plan.id}`).bearerToken(token).json({ version: 1, reuso: 4 }),
            422,
        )
        assert.deepEqual(campos(cuerpo), ['garantizado_pct'])
        assert.include(cuerpo.detail, `router ${routerId}`)
    })
})

test.group('Velocidad · excepción por router', () => {
    test('planes_routers sobrescribe y hereda; plan.velocidad_cambiada con router_id', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila()
        const planId = await crearPlanFila({
            reuso: 2,
            bajada_limitada_kbps: 2048,
            subida_limitada_kbps: 1024,
            rafaga_bajada_kbps: 30000,
        })
        const requestId = unico('req')
        const impl = await leer(
            client
                .put(`/api/v1/planes/${planId}/routers/${routerId}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ prioridad: 1, rafaga_subida_kbps: 6000 }),
            200,
        )
        assert.containsSubset(impl, {
            prioridad: 1,
            rafaga_subida_kbps: 6000,
            reuso: null,
            garantizado_pct: null,
        })

        const efectivo = await obtenerImplementacionPlan(planId, routerId)
        assert.containsSubset(efectivo, {
            reuso: 2,
            prioridad: 1,
            rafaga_bajada_kbps: 30000,
            rafaga_subida_kbps: 6000,
            rate_limit: '5M/20M 6M/30M 3750k/15M 16/16 1 2500k/10M',
            rate_limit_limitado: '1024k/2048k 0/0 0/0 0/0 1 512k/1024k',
        })
        const evs = await eventos(requestId)
        assert.deepEqual(evs, [
            {
                evento: 'plan.velocidad_cambiada',
                payload: {
                    plan_id: planId,
                    router_id: routerId,
                    campos: ['rafaga_subida_kbps', 'prioridad'],
                },
            },
        ])

        // ráfaga de la excepción ≤ MIR del plan: 422 por campo
        const cuerpo = await leer(
            client
                .put(`/api/v1/planes/${planId}/routers/${routerId}`)
                .bearerToken(token)
                .json({ version: impl.version, rafaga_subida_kbps: 5000 }),
            422,
        )
        assert.deepEqual(campos(cuerpo), ['rafaga_subida_kbps'])

        // null vuelve a heredar
        await estado(
            client
                .put(`/api/v1/planes/${planId}/routers/${routerId}`)
                .bearerToken(token)
                .json({ version: impl.version, prioridad: null, rafaga_subida_kbps: null }),
            200,
        )
        const heredado = await obtenerImplementacionPlan(planId, routerId)
        assert.equal(heredado.rate_limit, '5M/20M 0/30M 0/15M 0/16 8 2500k/10M')
    })

    test('aaa-cache reescribe los servicios del plan al recibir plan.velocidad_cambiada', async ({
        client,
        assert,
    }) => {
        await limpiarClavesAaa()
        const { token } = await usuarioConRoles(['admin'])
        const esc = await crearEscenarioRouter()
        const planId = await crearPlanFila({ bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024 })
        const servicio = await leer(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: esc.routerId,
                    plan_id: planId,
                }),
            201,
        )
        // cambio directo en la base (como si el gancho posterior al COMMIT hubiera fallado)
        await db.from('network.planes').where('id', planId).update({ prioridad: 3 })
        await redis().del(claveAaa(servicio.user_ppp))

        const consumidor = new ConsumidorAaaCache()
        assert.isTrue(consumidor.acepta('plan.velocidad_cambiada'))
        await consumidor.procesar({
            id: '1-0',
            evento: 'plan.velocidad_cambiada',
            payload: { plan_id: planId, router_id: esc.routerId, campos: ['prioridad'] },
        })
        const cache = JSON.parse((await redis().get(claveAaa(servicio.user_ppp)))!)
        assert.equal(cache.plan.rate_limit, '5M/20M 0/0 0/0 0/0 3 5M/20M')
    })
})

test.group('Velocidad · routers', () => {
    test('alta con control y capacidad; cambiar el control solo admin, con evento y 409', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const tecnico = await usuarioConRoles(['tecnico'])
        const router = await leer(
            client
                .post('/api/v1/routers')
                .bearerToken(admin.token)
                .json({
                    nombre: unico('Router'),
                    host: '192.0.2.10',
                    nas_ip: ipUnica(),
                    capacidad_bajada_kbps: 1_000_000,
                    capacidad_subida_kbps: 500_000,
                }),
            201,
        )
        assert.containsSubset(router, {
            control_velocidad: 'simple',
            modo_velocidad: 'simple',
            capacidad_bajada_kbps: 1_000_000,
            capacidad_subida_kbps: 500_000,
        })

        const ruta = `/api/v1/routers/${router.id}/cambiar-control-velocidad`
        await estado(
            client
                .post(ruta)
                .bearerToken(tecnico.token)
                .json({ version: router.version, control_velocidad: 'arbol_pcq' }),
            403,
        )
        await estado(
            client
                .post(ruta)
                .bearerToken(admin.token)
                .json({ version: router.version, control_velocidad: 'otro' }),
            422,
        )

        const requestId = unico('req')
        const cambiado = await leer(
            client.post(ruta).bearerToken(admin.token).header('X-Request-Id', requestId).json({
                version: router.version,
                control_velocidad: 'arbol_pcq',
                motivo: 'más de 500 clientes',
            }),
            200,
        )
        assert.containsSubset(cambiado, {
            control_velocidad: 'arbol_pcq',
            modo_velocidad: 'pcq',
            version: router.version + 1,
        })
        assert.deepEqual(await eventos(requestId), [
            {
                evento: 'router.control_cambiado',
                payload: {
                    router_id: router.id,
                    de: 'simple',
                    a: 'arbol_pcq',
                    capacidad_bajada_kbps: 1_000_000,
                    capacidad_subida_kbps: 500_000,
                    campos: ['control_velocidad'],
                    motivo: 'más de 500 clientes',
                },
            },
        ])
        const accion = await db
            .from('audit.acciones')
            .where({ request_id: requestId, accion: 'routers.cambiar_control_velocidad' })
            .first()
        assert.equal(Number(accion.actor_id), admin.usuario.id)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: router.id, campo: 'control_velocidad' })
            .whereRaw(`antes <> 'null'::jsonb`)
            .first()
        assert.deepEqual([cambio.antes, cambio.despues], ['simple', 'arbol_pcq'])

        // misma versión otra vez: 409
        await estado(
            client
                .post(ruta)
                .bearerToken(admin.token)
                .json({ version: router.version, control_velocidad: 'simple' }),
            409,
        )
        // ya está en ese modo: 200 sin evento
        const repetido = unico('req')
        await estado(
            client
                .post(ruta)
                .bearerToken(admin.token)
                .header('X-Request-Id', repetido)
                .json({ version: cambiado.version, control_velocidad: 'arbol_pcq' }),
            200,
        )
        assert.deepEqual(await eventos(repetido), [])

        // PUT /routers no cambia el control
        const editado = await leer(
            client
                .put(`/api/v1/routers/${router.id}`)
                .bearerToken(admin.token)
                .json({ version: cambiado.version, control_velocidad: 'simple' }),
            200,
        )
        assert.equal(editado.control_velocidad, 'arbol_pcq')
    })

    test('editar la capacidad emite router.control_cambiado con campos capacidad', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await crearRouterFila()
        const requestId = unico('req')
        await estado(
            client
                .put(`/api/v1/routers/${routerId}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, capacidad_bajada_kbps: 300_000 }),
            200,
        )
        assert.deepEqual(await eventos(requestId), [
            {
                evento: 'router.control_cambiado',
                payload: {
                    router_id: routerId,
                    de: 'simple',
                    a: 'simple',
                    capacidad_bajada_kbps: 300_000,
                    capacidad_subida_kbps: null,
                    campos: ['capacidad'],
                    motivo: null,
                },
            },
        ])
        const otro = unico('req')
        await estado(
            client
                .put(`/api/v1/routers/${routerId}`)
                .bearerToken(token)
                .header('X-Request-Id', otro)
                .json({ version: 2, host: '192.0.2.99' }),
            200,
        )
        assert.deepEqual(await eventos(otro), [])
    })
})
