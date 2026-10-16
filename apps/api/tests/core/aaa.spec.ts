import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { redis } from '#shared/redis'
import { claveAaa, escribirRegistrosAaa, publicarAaa, valorRedis, type RegistroAaa } from '#core/aaa'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Tarea 9: `GET /internal/aaa/servicio` y write-through de `aaa:user:<user_ppp>` según
 * `.claude/integration/contratos/aaa.md`.
 */

const TOKEN_INTERNO = () => env.get('INTERNAL_TOKEN')

async function leerRedis(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

async function crearServicioApi(client: any, token: string, extra: Record<string, unknown> = {}) {
    const escenario = await crearEscenarioRouter()
    const planId = await crearPlanFila({ bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024 })
    const clienteId = await crearClienteFila()
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: escenario.routerId,
                plan_id: planId,
                ...extra,
            }),
        201,
    )
    return { ...escenario, planId, clienteId, servicio: r.body() as Record<string, any> }
}

const internoGet = (client: any, userPpp: string) =>
    client.get('/api/v1/internal/aaa/servicio').qs({ user_ppp: userPpp }).bearerToken(TOKEN_INTERNO())

test.group('AAA · registro de autorización RADIUS', (group) => {
    group.setup(limpiarClavesAaa)

    test('crear un servicio escribe aaa:user:<user_ppp> sin TTL, igual a GET /internal/aaa/servicio', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio, planId, routerId, base, raiz } = await crearServicioApi(client, token)

        const cacheado = await leerRedis(servicio.user_ppp)
        assert.isNotNull(cacheado)
        assert.equal(await redis().ttl(claveAaa(servicio.user_ppp)), -1)

        const r = await estado(internoGet(client, servicio.user_ppp), 200)
        assert.deepEqual(r.body(), cacheado)

        const fila = await db.from('core.servicios').where('id', servicio.id).firstOrFail()
        assert.deepEqual(r.body(), {
            servicio_id: servicio.id,
            version: fila.version,
            user_ppp: servicio.user_ppp,
            pass_ppp: fila.pass_ppp,
            estado: 'activo',
            router_id: routerId,
            control_velocidad: 'simple',
            plan: {
                id: planId,
                subida_kbps: 5000,
                bajada_kbps: 20000,
                subida_limitada_kbps: 1024,
                bajada_limitada_kbps: 2048,
                rate_limit_override: null,
                profile_ppp: null,
                // plan sin campos nuevos: misma velocidad, más el limit-at del reuso 1 (= MIR)
                rate_limit: '5M/20M 0/0 0/0 0/0 8 5M/20M',
                rate_limit_limitado: '1024k/2048k 0/0 0/0 0/0 8 1024k/2048k',
                reuso: 1,
            },
            ipv4: { modo: 'estatico', ip: `${base}.2` },
            ipv6: {
                modo: 'radius_servicio',
                prefijo_enlace: `${raiz}00::/64`,
                prefijo_delegado: `${raiz}10::/56`,
            },
        })
        // cifrada v1, nunca en claro
        assert.match(r.body().pass_ppp, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
    })

    test('endpoint: 401 sin token interno, 404 user_ppp inexistente, responde rápido', async ({
        client,
        assert,
    }) => {
        await estado(client.get('/api/v1/internal/aaa/servicio').qs({ user_ppp: 'x' }), 401)
        await estado(
            client.get('/api/v1/internal/aaa/servicio').qs({ user_ppp: 'x' }).bearerToken('otro-token'),
            401,
        )
        await estado(internoGet(client, 'no-existe-nunca'), 404)

        const { token } = await usuarioConRoles(['soporte'])
        const { servicio } = await crearServicioApi(client, token)
        // mejor mediana de 3 rondas de 7 (tolera picos de carga de la máquina de CI)
        let mediana = Number.POSITIVE_INFINITY
        for (let ronda = 0; ronda < 3 && mediana >= 20; ronda++) {
            const tiempos: number[] = []
            for (let i = 0; i < 7; i++) {
                const inicio = performance.now()
                await estado(internoGet(client, servicio.user_ppp), 200)
                tiempos.push(performance.now() - inicio)
            }
            tiempos.sort((a, b) => a - b)
            mediana = Math.min(mediana, tiempos[3]!)
        }
        assert.isBelow(mediana, 20, `mediana ${mediana.toFixed(1)} ms`)
    })

    test('cambiar estado reescribe Redis con el estado y la version nuevos', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio } = await crearServicioApi(client, token)
        const antes = (await leerRedis(servicio.user_ppp))!

        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/suspender`)
                .bearerToken(token)
                .json({ motivo: 'mora' }),
            200,
        )
        const despues = (await leerRedis(servicio.user_ppp))!
        assert.equal(despues.estado, 'suspendido')
        assert.equal(despues.version, antes.version + 1)

        await new CambiarEstadoServicio().execute(
            { servicioId: servicio.id, nuevo: 'limitado', motivo: 'evaluación' },
            contextoPrueba(),
        )
        assert.equal((await leerRedis(servicio.user_ppp))!.estado, 'limitado')
    })

    test('transacción externa revertida: Redis no cambia', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio } = await crearServicioApi(client, token)
        await assert.rejects(() =>
            db.transaction(async (trx) => {
                await new CambiarEstadoServicio().execute(
                    { servicioId: servicio.id, nuevo: 'suspendido', motivo: 'anidada' },
                    contextoPrueba(),
                    { trx },
                )
                throw new Error('falla externa')
            }),
        )
        assert.equal((await leerRedis(servicio.user_ppp))!.estado, 'activo')
    })

    test('editar plan y su implementación en el router reescribe los servicios del plan', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { token: tokenAdmin } = await usuarioConRoles(['admin'])
        const { servicio, planId, routerId } = await crearServicioApi(client, token)

        const plan = await estado(client.get(`/api/v1/planes/${planId}`).bearerToken(tokenAdmin), 200)
        await estado(
            client
                .put(`/api/v1/planes/${planId}`)
                .bearerToken(tokenAdmin)
                .json({ version: plan.body().version, bajada_kbps: 50000, subida_kbps: 10000 }),
            200,
        )
        let cacheado = (await leerRedis(servicio.user_ppp))!
        assert.equal(cacheado.plan.bajada_kbps, 50000)
        assert.equal(cacheado.plan.subida_kbps, 10000)

        await estado(
            client.put(`/api/v1/planes/${planId}/routers/${routerId}`).bearerToken(tokenAdmin).json({
                profile_ppp: 'plan-50',
                rate_limit_override: '10M/50M 12M/60M 8M/40M 10/10',
                pool_ipv6_enlace: 'pool-enlace',
            }),
            200,
        )
        cacheado = (await leerRedis(servicio.user_ppp))!
        assert.equal(cacheado.plan.profile_ppp, 'plan-50')
        assert.equal(cacheado.plan.rate_limit_override, '10M/50M 12M/60M 8M/40M 10/10')
        const r = await estado(internoGet(client, servicio.user_ppp), 200)
        assert.deepEqual(r.body(), cacheado)
    })

    test('retirar deja lápida en Redis y el endpoint responde 200 con estado retirado', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio } = await crearServicioApi(client, token)
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'baja' }),
            200,
        )
        const lapida = (await leerRedis(servicio.user_ppp))!
        assert.containsSubset(lapida, { eliminado: true, user_ppp: servicio.user_ppp })
        const r = await estado(internoGet(client, servicio.user_ppp), 200)
        assert.equal(r.body().estado, 'retirado')
        assert.isNull(r.body().ipv4)
        assert.deepEqual(r.body().ipv6, {
            modo: 'radius_servicio',
            prefijo_enlace: null,
            prefijo_delegado: null,
        })
    })

    test('una escritura atrasada (version menor) no pisa la vigente ni la lápida', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio } = await crearServicioApi(client, token)
        const viejo = (await leerRedis(servicio.user_ppp)) as RegistroAaa
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'baja' }),
            200,
        )
        // simula un gancho atrasado que leyó antes del retiro
        await escribirRegistrosAaa([valorRedis(viejo)])
        assert.containsSubset((await leerRedis(servicio.user_ppp))!, { eliminado: true })

        // la misma versión o mayor sí se escribe (republicar desde la base)
        await publicarAaa([servicio.id])
        assert.containsSubset((await leerRedis(servicio.user_ppp))!, { eliminado: true })
    })

    test('modos: radius_pool usa los pools de planes_routers; IPv4 por pool sin red estática', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planId, routerId } = await crearServicioApi(client, token, {
            ipv6_modo: 'radius_pool',
        })
        await estado(
            client.put(`/api/v1/planes/${planId}/routers/${routerId}`).bearerToken(token).json({
                pool_ipv4: 'pool-v4',
                pool_ipv6_enlace: 'pool-enlace',
                pool_ipv6_delegacion: 'pool-pd',
            }),
            200,
        )
        let cacheado = (await leerRedis(servicio.user_ppp))!
        assert.deepEqual(cacheado.ipv6, {
            modo: 'radius_pool',
            pool_enlace: 'pool-enlace',
            pool_delegacion: 'pool-pd',
        })
        // con IPv4 vigente manda la asignación; sin ella, el pool del router
        assert.equal(cacheado.ipv4.modo, 'estatico')
        await db
            .from('network.ipv4_asignaciones')
            .where('servicio_id', servicio.id)
            .whereNull('fin')
            .update({ fin: new Date() })
        await publicarAaa([servicio.id])
        cacheado = (await leerRedis(servicio.user_ppp))!
        assert.deepEqual(cacheado.ipv4, { modo: 'pool', pool: 'pool-v4' })
    })
})
