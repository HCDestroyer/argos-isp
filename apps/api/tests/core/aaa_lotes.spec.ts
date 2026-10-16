import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { redis } from '#shared/redis'
import { claveAaa, repoblarAaa } from '#core/aaa'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Semana 3, tarea 2 (pedido de A2): `POST /internal/aaa/servicios` y `node ace aaa:repoblar`.
 */

const TOKEN_INTERNO = () => env.get('INTERNAL_TOKEN')

async function leerRedis(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

async function crearServicios(client: any, token: string, cantidad: number) {
    const escenario = await crearEscenarioRouter()
    const planId = await crearPlanFila()
    const servicios: Array<Record<string, any>> = []
    for (let i = 0; i < cantidad; i++) {
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: escenario.routerId,
                    plan_id: planId,
                }),
            201,
        )
        servicios.push(r.body())
    }
    return servicios
}

const lote = (client: any, cuerpo: Record<string, unknown>) =>
    client.post('/api/v1/internal/aaa/servicios').bearerToken(TOKEN_INTERNO()).json(cuerpo)

async function ace(comando: string, argumentos: string[]) {
    const kernel = await app.container.make('ace')
    const resultado = await kernel.exec(comando, argumentos)
    if (resultado.exitCode) throw resultado.error ?? new Error(`Falló ${comando}`)
}

test.group('AAA · carga por lotes', (group) => {
    group.setup(limpiarClavesAaa)

    test('POST /internal/aaa/servicios por user_ppp y por servicio_ids: mismo JSON que el GET, inexistentes omitidos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const [a, b] = await crearServicios(client, token, 2)

        const r = await estado(
            lote(client, { user_ppp: [b!.user_ppp, 'no-existe-nunca', a!.user_ppp, b!.user_ppp] }),
            200,
        )
        assert.isNull(r.body().nextCursor)
        assert.deepEqual(
            r.body().data.map((x: { user_ppp: string }) => x.user_ppp),
            [b!.user_ppp, a!.user_ppp],
        )
        const individual = await estado(
            client
                .get('/api/v1/internal/aaa/servicio')
                .qs({ user_ppp: a!.user_ppp })
                .bearerToken(TOKEN_INTERNO()),
            200,
        )
        assert.deepEqual(r.body().data[1], individual.body())

        const porId = await estado(lote(client, { servicio_ids: [a!.id, 99_999_999, b!.id] }), 200)
        assert.deepEqual(
            porId.body().data.map((x: { servicio_id: number }) => x.servicio_id),
            [a!.id, b!.id],
        )
    })

    test('sin lista pagina todos los PPPoE por servicio_id ascendente (retirados incluidos)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creados = await crearServicios(client, token, 3)
        await estado(
            client
                .post(`/api/v1/servicios/${creados[0]!.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'baja' }),
            200,
        )

        const vistos: Array<{ servicio_id: number; estado: string }> = []
        let cursor: string | null = null
        let paginas = 0
        do {
            const cuerpo: Record<string, unknown> = { limit: 2, ...(cursor ? { cursor } : {}) }
            const r = await estado(lote(client, cuerpo), 200)
            assert.isAtMost(r.body().data.length, 2)
            vistos.push(...r.body().data)
            cursor = r.body().nextCursor
            paginas++
        } while (cursor && paginas < 10_000)

        const ids = vistos.map((v) => v.servicio_id)
        assert.deepEqual(
            ids,
            [...ids].sort((x, y) => x - y),
        )
        assert.equal(new Set(ids).size, ids.length)
        for (const s of creados) assert.include(ids, s.id)
        assert.equal(vistos.find((v) => v.servicio_id === creados[0]!.id)!.estado, 'retirado')
    })

    test('401 sin token interno; 422 con ambas listas, con cursor y lista, o con más de 100', async ({
        client,
    }) => {
        await estado(client.post('/api/v1/internal/aaa/servicios').json({ user_ppp: ['x'] }), 401)
        await estado(
            client
                .post('/api/v1/internal/aaa/servicios')
                .bearerToken('otro')
                .json({ user_ppp: ['x'] }),
            401,
        )
        await estado(lote(client, { user_ppp: ['x'], servicio_ids: [1] }), 422)
        await estado(lote(client, { user_ppp: ['x'], cursor: 'WzFd' }), 422)
        await estado(lote(client, { user_ppp: Array.from({ length: 101 }, (_, i) => `u${i}`) }), 422)
        await estado(lote(client, { user_ppp: [] }), 422)
        await estado(lote(client, { cursor: 'no-es-cursor' }), 422)
    })

    test('aaa:repoblar reescribe todas las claves por lotes, respeta version mayor y es idempotente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const [a, b, c] = await crearServicios(client, token, 3)
        await estado(
            client.post(`/api/v1/servicios/${c!.id}/retirar`).bearerToken(token).json({ motivo: 'baja' }),
            200,
        )
        const esperadoA = await leerRedis(a!.user_ppp)

        // Redis perdido: sin claves; una clave de b con version mayor (escritura posterior) y una huérfana
        await limpiarClavesAaa()
        const adelantado = {
            ...(esperadoA as object),
            servicio_id: b!.id,
            user_ppp: b!.user_ppp,
            version: 999,
        }
        await redis().set(claveAaa(b!.user_ppp), JSON.stringify(adelantado))
        await redis().set(
            claveAaa('huerfano-sin-servicio'),
            JSON.stringify({ user_ppp: 'huerfano-sin-servicio' }),
        )
        await redis().set(
            claveAaa('lapida-vieja'),
            JSON.stringify({ eliminado: true, user_ppp: 'lapida-vieja' }),
        )

        await ace('aaa:repoblar', ['--lote=2'])

        assert.deepEqual(await leerRedis(a!.user_ppp), esperadoA)
        assert.equal((await leerRedis(b!.user_ppp))!.version, 999)
        assert.containsSubset((await leerRedis(c!.user_ppp))!, { eliminado: true, servicio_id: c!.id })
        assert.equal(await redis().ttl(claveAaa(a!.user_ppp)), -1)

        const resumen = await repoblarAaa({ lote: 2 })
        assert.isAtLeast(resumen.servicios, 3)
        assert.isAtLeast(resumen.lapidas, 1)
        assert.isAtLeast(resumen.omitidos, 1)
        assert.equal(resumen.escritos + resumen.omitidos, resumen.servicios)
        assert.equal(resumen.lotes, Math.ceil(resumen.servicios / 2))
        assert.include(resumen.huerfanas, 'huerfano-sin-servicio')
        assert.notInclude(resumen.huerfanas, 'lapida-vieja')
        // idempotente: la segunda corrida deja lo mismo
        assert.deepEqual(await leerRedis(a!.user_ppp), esperadoA)

        // --forzar (tras restaurar un respaldo) sí reemplaza la version mayor
        await ace('aaa:repoblar', ['--forzar'])
        const forzado = (await leerRedis(b!.user_ppp))!
        assert.equal(forzado.version, b!.version)
        assert.equal(forzado.servicio_id, b!.id)
    })
})
