import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Tipo de plan (decisión del PM, 19 oct): `residencial` por defecto, `empresarial`, `dedicado`.
 * Visible en `Plan.tipo` y en `Servicio.plan_tipo`, filtro `?tipo=` y advertencias (`warnings[]`),
 * nunca 422.
 */

function cuerpoPlan(extra: Record<string, unknown> = {}) {
    return {
        nombre: unico('Plan'),
        precio: '300.00',
        bajada_kbps: 20000,
        subida_kbps: 20000,
        bajada_limitada_kbps: 512,
        subida_limitada_kbps: 512,
        ...extra,
    }
}

test.group('Tipo de plan', () => {
    test('por defecto residencial; se edita con version y queda en audit.cambios', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const directo = await crearPlanFila()
        const fila = await db.from('network.planes').where('id', directo).firstOrFail()
        assert.equal(fila.tipo, 'residencial')

        const creado = await estado(client.post('/api/v1/planes').bearerToken(token).json(cuerpoPlan()), 201)
        assert.include(creado.body(), { tipo: 'residencial' })
        assert.deepEqual(creado.body().warnings, [])

        const editado = await estado(
            client
                .put(`/api/v1/planes/${creado.body().id}`)
                .bearerToken(token)
                .json({ version: creado.body().version, tipo: 'empresarial' }),
            200,
        )
        assert.equal(editado.body().tipo, 'empresarial')
        await estado(
            client
                .put(`/api/v1/planes/${creado.body().id}`)
                .bearerToken(token)
                .json({ version: creado.body().version, tipo: 'dedicado' }),
            409,
        )
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'plan', entidad_id: creado.body().id, campo: 'tipo' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['residencial', 'empresarial'])
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'plan.velocidad_cambiada')
            .whereRaw(`(payload->>'plan_id')::bigint = ?`, [creado.body().id])
            .first()
        assert.isNull(evento, 'cambiar el tipo no cambia la velocidad')
        await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo: 'otro' })),
            422,
        )
    })

    test('dedicado asimétrico o compartido: advertencias, nunca 422', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const simetrico = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo: 'dedicado' })),
            201,
        )
        assert.deepEqual(simetrico.body().warnings, [])
        const malo = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ tipo: 'dedicado', subida_kbps: 5000, reuso: 4 })),
            201,
        )
        assert.sameMembers(
            malo.body().warnings.map((w: any) => w.codigo),
            ['plan_dedicado_asimetrico', 'plan_dedicado_compartido'],
        )
        const residencial = await estado(
            client
                .post('/api/v1/planes')
                .bearerToken(token)
                .json(cuerpoPlan({ subida_kbps: 5000, reuso: 4 })),
            201,
        )
        assert.deepEqual(residencial.body().warnings, [])
    })

    test('servicio: plan_tipo, filtro ?tipo= y advertencia de cliente CF en un plan empresarial', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const residencial = await crearPlanFila()
        const empresarial = await crearPlanFila({ tipo: 'empresarial' })
        const cf = await crearClienteFila({ tipo_documento_fiscal: 'cf' })

        const enResidencial = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                cliente_id: cf,
                router_id: routerId,
                plan_id: residencial,
                plantilla_facturacion_id: null,
            }),
            201,
        )
        assert.include(enResidencial.body(), { plan_tipo: 'residencial' })
        assert.deepEqual(enResidencial.body().warnings, [])

        const enEmpresarial = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                cliente_id: cf,
                router_id: routerId,
                plan_id: empresarial,
                plantilla_facturacion_id: null,
            }),
            201,
        )
        assert.include(enEmpresarial.body(), { plan_tipo: 'empresarial' })
        assert.deepEqual(
            enEmpresarial.body().warnings.map((w: any) => w.codigo),
            ['servicio_cliente_cf'],
        )

        // cambiar de plan también advierte
        const cambio = await estado(
            client
                .put(`/api/v1/servicios/${enResidencial.body().id}`)
                .bearerToken(token)
                .json({ version: enResidencial.body().version, plan_id: empresarial }),
            200,
        )
        assert.equal(cambio.body().plan_tipo, 'empresarial')
        assert.lengthOf(cambio.body().warnings, 1)

        // GET no trae warnings; el filtro por tipo del plan
        const visto = await estado(
            client.get(`/api/v1/servicios/${enEmpresarial.body().id}`).bearerToken(token),
            200,
        )
        assert.notProperty(visto.body(), 'warnings')
        const filtrados = await estado(
            client.get('/api/v1/servicios').bearerToken(token).qs({ tipo: 'empresarial', cliente_id: cf }),
            200,
        )
        assert.sameMembers(
            filtrados.body().data.map((s: any) => s.id),
            [enResidencial.body().id, enEmpresarial.body().id],
        )
        const ninguno = await estado(
            client.get('/api/v1/servicios').bearerToken(token).qs({ tipo: 'residencial', cliente_id: cf }),
            200,
        )
        assert.lengthOf(ninguno.body().data, 0)

        const planes = await estado(
            client.get('/api/v1/planes').bearerToken(token).qs({ tipo: 'empresarial', limit: 200 }),
            200,
        )
        const tipos = new Set(planes.body().data.map((p: any) => p.tipo))
        assert.deepEqual([...tipos], ['empresarial'])
        assert.include(
            planes.body().data.map((p: any) => p.id),
            empresarial,
        )
    })
})
