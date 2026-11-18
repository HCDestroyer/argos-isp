import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import type { ContextoAccion } from '#shared/contexto'
import CrearServicio from '#core/actions/crear_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import EditarPlan from '#network/actions/editar_plan'
import { verPlan } from '#network/consultas/planes'

/**
 * Contrato Iris 0.8.0, bloque C (A1): `precio_mensual` y `moneda` en el esquema `Servicio` (lista y
 * detalle) y `precio` en `campos[]` de `servicio.config_cambiada` y de `catalogo.cambiado` (plan).
 */

function contextoPanel(): ContextoAccion {
    return { ...contextoPrueba(), canal: 'panel' }
}

async function eventos(requestId: string, evento: string) {
    const filas = await db
        .from('audit.outbox')
        .where('request_id', requestId)
        .where('evento', evento)
        .orderBy('id')
    return filas.map((f) => f.payload as Record<string, any>)
}

/** `campos` de cada `servicio.config_cambiada` de la petición. */
async function camposConfig(requestId: string) {
    const lista = await eventos(requestId, 'servicio.config_cambiada')
    return lista.map((e) => e.campos)
}

async function cuerpo(peticion: PromiseLike<any>, status: number): Promise<Record<string, any>> {
    const r = await estado(peticion, status)
    return r.body() as Record<string, any>
}

async function servicioDePrueba(precio = '150.00') {
    const { routerId } = await crearEscenarioRouter()
    const planId = await crearPlanFila({ precio })
    const servicio = await new CrearServicio().execute(
        { cliente_id: await crearClienteFila(), router_id: routerId, plan_id: planId },
        contextoPanel(),
    )
    return { servicio, planId }
}

async function precioEnApi(client: any, token: string, servicioId: number, planId: number) {
    const detalle = await cuerpo(client.get(`/api/v1/servicios/${servicioId}`).bearerToken(token), 200)
    const lista = await cuerpo(
        client.get(`/api/v1/servicios?plan_id=${planId}&limit=200`).bearerToken(token),
        200,
    )
    const enLista = lista.data.find((s: { id: number }) => s.id === servicioId)
    return { detalle, enLista }
}

test.group('Iris 0.8.0 · precio_mensual y moneda del servicio', (group) => {
    group.setup(limpiarClavesAaa)

    test('sin costo_override: el precio del plan con 2 decimales, en lista y detalle', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planId } = await servicioDePrueba('199.5')
        const { detalle, enLista } = await precioEnApi(client, token, servicio.id, planId)
        assert.equal(detalle.precio_mensual, '199.50')
        assert.equal(detalle.moneda, 'GTQ')
        assert.equal(enLista.precio_mensual, '199.50')
        assert.equal(enLista.moneda, 'GTQ')
    })

    test('con costo_override: manda el override; config_cambiada con precio y sin tramo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planId } = await servicioDePrueba()
        const tramosAntes = await db
            .from('network.asignaciones_historial')
            .where('servicio_id', servicio.id)
            .count('* as n')

        const ctx = contextoPanel()
        const editado = await new EditarServicio().execute(
            { id: servicio.id, version: servicio.version, costo_override: '99.5' },
            ctx,
        )
        assert.equal(editado.precio_mensual, '99.50')
        const { detalle, enLista } = await precioEnApi(client, token, servicio.id, planId)
        assert.equal(detalle.precio_mensual, '99.50')
        assert.equal(detalle.costo_override, '99.50')
        assert.equal(enLista.precio_mensual, '99.50')
        assert.deepEqual(await camposConfig(ctx.requestId), [['precio']])
        const tramosDespues = await db
            .from('network.asignaciones_historial')
            .where('servicio_id', servicio.id)
            .count('* as n')
        assert.deepEqual(tramosDespues, tramosAntes)
        // el valor calculado no entra al diff (ya va costo_override)
        const filasCambios = await db
            .from('audit.cambios')
            .where('request_id', ctx.requestId)
            .where('entidad_tipo', 'servicio')
            .select('campo')
        const campos = filasCambios.map((f) => f.campo as string)
        assert.include(campos, 'costo_override')
        assert.notInclude(campos, 'precio_mensual')

        // quitar el override: vuelve al precio del plan
        const ctx2 = contextoPanel()
        const otra = await new EditarServicio().execute(
            { id: servicio.id, version: editado.version, costo_override: null },
            ctx2,
        )
        assert.equal(otra.precio_mensual, '150.00')
        assert.deepEqual(await camposConfig(ctx2.requestId), [['precio']])

        // el mismo precio escrito como override no cambia el precio efectivo: sin evento
        const ctx3 = contextoPanel()
        await new EditarServicio().execute(
            { id: servicio.id, version: otra.version, costo_override: '150.00' },
            ctx3,
        )
        assert.lengthOf(await eventos(ctx3.requestId, 'servicio.config_cambiada'), 0)
    })

    test('cambio de plan con otro precio: plan y precio; mismo precio: solo plan', async ({ assert }) => {
        const { servicio } = await servicioDePrueba()
        const caro = await crearPlanFila({ precio: '300.00' })
        const ctx = contextoPanel()
        const editado = await new EditarServicio().execute(
            { id: servicio.id, version: servicio.version, plan_id: caro },
            ctx,
        )
        assert.equal(editado.precio_mensual, '300.00')
        assert.deepEqual(await camposConfig(ctx.requestId), [['plan', 'precio']])
        const igual = await crearPlanFila({ precio: '300.00' })
        const ctx2 = contextoPanel()
        await new EditarServicio().execute(
            { id: servicio.id, version: editado.version, plan_id: igual },
            ctx2,
        )
        assert.deepEqual(await camposConfig(ctx2.requestId), [['plan']])
    })

    test('precio del plan: catalogo.cambiado con precio y el servicio lo refleja', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planId } = await servicioDePrueba()
        const plan = await verPlan(planId)
        const ctx = contextoPanel()
        await new EditarPlan().execute({ id: planId, version: plan.version, precio: '175.25' }, ctx)
        assert.deepEqual(await eventos(ctx.requestId, 'catalogo.cambiado'), [
            { catalogo: 'plan', id: planId, empresa_id: null, campos: ['precio'] },
        ])
        const { detalle } = await precioEnApi(client, token, servicio.id, planId)
        assert.equal(detalle.precio_mensual, '175.25')
    })

    test('plan temporal: precio solo si el precio efectivo cambia', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio, planId } = await servicioDePrueba()
        const mismoPrecio = await crearPlanFila({ bajada_kbps: 50000, subida_kbps: 10000, precio: '150.00' })
        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/planes-temporales`)
                .bearerToken(token)
                .json({ plan_id: mismoPrecio, dias: 30 }),
            201,
        )
        const filas = await db
            .from('audit.outbox')
            .where('evento', 'servicio.config_cambiada')
            .whereRaw(`payload->>'servicio_id' = ?`, [String(servicio.id)])
            .whereRaw(`payload->>'plan_temporal_id' = ?`, [String(r.body().id)])
            .select('payload')
        assert.deepEqual(
            filas.map((f) => f.payload.campos),
            [['plan']],
        )
        const ver = await cuerpo(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.equal(ver.plan_id, mismoPrecio)
        assert.notEqual(ver.plan_id, planId)
        assert.equal(ver.precio_mensual, '150.00')
    })
})
