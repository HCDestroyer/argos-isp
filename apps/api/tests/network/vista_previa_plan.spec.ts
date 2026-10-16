import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'

/**
 * Semana 3, tarea 5: `POST /planes/vista-previa` calcula con `app/network/velocidad.ts` (mismos
 * casos que `tests/network/velocidad.spec.ts`) y no guarda nada.
 */

const base = { bajada_kbps: 20000, subida_kbps: 5000, bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024 }

test.group('Planes · vista previa del rate-limit', () => {
    test('valores por defecto: limit-at = MIR y padre con 1 activo', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['lectura'])
        const r = await estado(client.post('/api/v1/planes/vista-previa').bearerToken(token).json(base), 200)
        assert.deepEqual(r.body(), {
            rate_limit: '5M/20M 0/0 0/0 0/0 8 5M/20M',
            rate_limit_limitado: '1024k/2048k 0/0 0/0 0/0 8 1024k/2048k',
            garantizado_pct_efectivo: 100,
            limit_at_servicio_kbps: { subida: 5000, bajada: 20000 },
            padre: {
                max_limit: '5M/20M',
                limit_at: '5M/20M',
                prioridad: 8,
                max_limit_kbps: { subida: 5000, bajada: 20000 },
                limit_at_kbps: { subida: 5000, bajada: 20000 },
                activos: 1,
            },
        })
    })

    test('ráfaga, prioridad, reuso y activos; override reemplaza solo el activo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const planesAntes = await db.from('network.planes').count('* as n').first()
        const r = await estado(
            client
                .post('/api/v1/planes/vista-previa')
                .bearerToken(token)
                .json({
                    ...base,
                    rafaga_bajada_kbps: 30000,
                    rafaga_subida_kbps: 8000,
                    prioridad: 2,
                    reuso: 2,
                    activos: 4,
                }),
            200,
        )
        assert.equal(r.body().rate_limit, '5M/20M 8M/30M 3750k/15M 16/16 2 2500k/10M')
        assert.equal(r.body().rate_limit_limitado, '1024k/2048k 0/0 0/0 0/0 2 512k/1024k')
        assert.equal(r.body().garantizado_pct_efectivo, 50)
        assert.equal(r.body().padre.max_limit, '10M/40M')
        assert.equal(r.body().padre.limit_at, '10M/40M')
        assert.equal(r.body().padre.activos, 4)

        const tres = await estado(
            client
                .post('/api/v1/planes/vista-previa')
                .bearerToken(token)
                .json({ ...base, reuso: 3 }),
            200,
        )
        assert.equal(tres.body().rate_limit, '5M/20M 0/0 0/0 0/0 8 1666k/6666k')
        assert.equal(tres.body().garantizado_pct_efectivo, 33.33)

        const override = await estado(
            client
                .post('/api/v1/planes/vista-previa')
                .bearerToken(token)
                .json({ ...base, rate_limit_override: '6M/24M 8M/30M 5M/20M 10/10' }),
            200,
        )
        assert.equal(override.body().rate_limit, '6M/24M 8M/30M 5M/20M 10/10')
        assert.equal(override.body().rate_limit_limitado, '1024k/2048k 0/0 0/0 0/0 8 1024k/2048k')

        // no guarda nada ni deja auditoría
        const planesDespues = await db.from('network.planes').count('* as n').first()
        assert.equal(planesDespues.n, planesAntes.n)
    })

    test('422 por campo con las reglas de crear el plan; 401 sin token; 403 sin planes.ver', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const cir = await estado(
            client
                .post('/api/v1/planes/vista-previa')
                .bearerToken(token)
                .json({ ...base, reuso: 4, garantizado_pct: 50 }),
            422,
        )
        assert.equal(cir.body().errors[0].field, 'garantizado_pct')
        const rafaga = await estado(
            client
                .post('/api/v1/planes/vista-previa')
                .bearerToken(token)
                .json({ ...base, rafaga_bajada_kbps: 10000 }),
            422,
        )
        assert.equal(rafaga.body().errors[0].field, 'rafaga_bajada_kbps')
        await estado(
            client.post('/api/v1/planes/vista-previa').bearerToken(token).json({ bajada_kbps: 1 }),
            422,
        )
        await estado(client.post('/api/v1/planes/vista-previa').json(base), 401)
        // sin roles no hay planes.ver
        const sinRoles = await usuarioConRoles([])
        await estado(client.post('/api/v1/planes/vista-previa').bearerToken(sinRoles.token).json(base), 403)
    })
})
