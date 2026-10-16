import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { crearPlantillaFila, escenario, estadoServicio, generar } from '#tests/billing/ayudas_billing'
import VencerFacturas from '#billing/actions/vencer_facturas'

/**
 * Tarea 11: excepciones a la plantilla de facturación por servicio.
 */

async function cambiosDe(servicioId: number, requestId: string) {
    const filas = await db
        .from('audit.cambios')
        .where({ entidad_tipo: 'servicio', entidad_id: servicioId, request_id: requestId })
        .orderBy('campo')
        .select('campo', 'antes', 'despues')
    return filas as Array<{ campo: string; antes: unknown; despues: unknown }>
}

async function accionesDe(requestId: string) {
    const filas = await db
        .from('audit.acciones')
        .where('request_id', requestId)
        .orderBy('id')
        .select('accion')
    return filas.map((f) => f.accion as string)
}

test.group('Servicios · excepciones a la plantilla', () => {
    test('alta con excepciones: se guardan, salen en la vista, en audit.cambios y en la configuración efectiva', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const plantillaId = await crearPlantillaFila({ dia: 1, dias_gracia: 5 })
        const requestId = unico('req')

        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    plantilla_facturacion_id: plantillaId,
                    excepciones: { dia: 15, mora_valor: '10.00', reglas_promesa: { plazo_max_dias: 3 } },
                }),
            201,
        )
        const s = creado.body()
        assert.deepEqual(s.excepciones, {
            dia: 15,
            mora_valor: '10.00',
            reglas_promesa: { plazo_max_dias: 3 },
        })

        const filas = await db
            .from('core.servicios_excepciones')
            .where('servicio_id', s.id)
            .orderBy('campo')
            .select('campo', 'valor')
        assert.deepEqual(
            filas.map((f) => f.campo),
            ['dia', 'mora_valor', 'reglas_promesa'],
        )

        const cambios = await cambiosDe(s.id, requestId)
        const dia = cambios.find((c) => c.campo === 'excepcion_dia')
        assert.exists(dia)
        assert.equal(dia!.antes, null)
        assert.equal(dia!.despues, 15)
        assert.notExists(cambios.find((c) => c.campo === 'excepciones'))

        const config = await estado(
            client.get(`/api/v1/servicios/${s.id}/configuracion-efectiva`).bearerToken(token),
            200,
        )
        const c = config.body()
        assert.equal(c.servicio_id, s.id)
        assert.equal(c.plantilla_facturacion_id, plantillaId)
        assert.equal(c.plan.id, planId)
        assert.containsSubset(c.facturacion, {
            plantilla_id: plantillaId,
            dia: 15,
            dias_gracia: 5,
            mora_valor: '10.00',
            excepciones: ['dia', 'mora_valor', 'reglas_promesa'],
        })
        assert.equal(c.facturacion.reglas_promesa.plazo_max_dias, 3)
        assert.deepEqual(c.excepciones, s.excepciones)

        const visto = await estado(client.get(`/api/v1/servicios/${s.id}`).bearerToken(token), 200)
        assert.deepEqual(visto.body().excepciones, s.excepciones)
    })

    test('editar: cambia, borra con null y deja el diff por campo; sin plantilla la facturación es null', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: await crearPlanFila(),
                    excepciones: { dia: 10, prorrateo: false },
                }),
            201,
        )
        const id = creado.body().id
        const requestId = unico('req')
        const editado = await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, excepciones: { dia: 20, prorrateo: null, hora_corte: '06:30' } }),
            200,
        )
        assert.deepEqual(editado.body().excepciones, { dia: 20, hora_corte: '06:30' })
        assert.equal(editado.body().version, 2)

        const cambios = await cambiosDe(id, requestId)
        assert.deepEqual(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['excepcion_dia', 10, 20],
                ['excepcion_hora_corte', null, '06:30'],
                ['excepcion_prorrateo', false, null],
            ],
        )

        const config = await estado(
            client.get(`/api/v1/servicios/${id}/configuracion-efectiva`).bearerToken(token),
            200,
        )
        assert.isNull(config.body().facturacion)
        assert.deepEqual(config.body().excepciones, { dia: 20, hora_corte: '06:30' })

        // borrar algo que no existe no cambia nada
        const igual = await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .json({ version: 2, excepciones: { mora_tipo: null } }),
            200,
        )
        assert.deepEqual(igual.body().excepciones, { dia: 20, hora_corte: '06:30' })
    })

    test('422 con el campo: campo no exceptuable o valor inválido (validarExcepcion de A3)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const base = {
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            plan_id: await crearPlanFila(),
        }

        const desconocido = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...base, excepciones: { ciclo: 'aniversario' } }),
            422,
        )
        assert.deepEqual(
            desconocido.body().errors.map((e: { field: string }) => e.field),
            ['excepciones.ciclo'],
        )

        const invalido = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...base, excepciones: { dia: 31, hora_corte: '25:00' } }),
            422,
        )
        assert.sameMembers(
            invalido.body().errors.map((e: { field: string }) => e.field),
            ['excepciones.dia', 'excepciones.hora_corte'],
        )
        const cuenta = await db.from('core.servicios').where('cliente_id', base.cliente_id).count('* as n')
        assert.equal(Number(cuenta[0].n), 0)
    })

    test('una excepción que afecta el corte llama evaluarEstadoServicio; las demás no', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const { servicioId } = await escenario({
            plantilla: { facturas_para_limitar: 0, facturas_para_cortar: 3, hora_corte: '00:00' },
            servicio: { router_id: routerId, ipv6_modo: 'ninguno' },
        })
        await generar(servicioId, '2026-10-01')
        await new VencerFacturas().execute({ servicio_id: servicioId, hasta: '2026-10-06' }, contextoPrueba())
        assert.equal(await estadoServicio(servicioId), 'activo')

        const reqDia = unico('req')
        await estado(
            client
                .put(`/api/v1/servicios/${servicioId}`)
                .bearerToken(token)
                .header('X-Request-Id', reqDia)
                .json({ version: 1, excepciones: { dias_gracia: 2 } }),
            200,
        )
        assert.notInclude(await accionesDe(reqDia), 'servicios.evaluar_estado')

        const reqCorte = unico('req')
        const editado = await estado(
            client
                .put(`/api/v1/servicios/${servicioId}`)
                .bearerToken(token)
                .header('X-Request-Id', reqCorte)
                .json({ version: 2, excepciones: { facturas_para_cortar: 1 } }),
            200,
        )
        assert.include(await accionesDe(reqCorte), 'servicios.evaluar_estado')
        assert.equal(editado.body().estado, 'suspendido')
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        const evento = await db
            .from('audit.outbox')
            .where({ request_id: reqCorte, evento: 'servicio.estado_cambiado' })
            .first()
        assert.containsSubset(evento.payload, { servicio_id: servicioId, de: 'activo', a: 'suspendido' })
    })
})
