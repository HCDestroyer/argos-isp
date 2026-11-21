import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { conActor, tokenIris } from '#tests/core/ayudas_iris_0100'
import { ejecutarCronCore } from '#core/jobs'

/**
 * Servicio pendiente sin IP (contrato Iris 0.10.0 §3.4.1, A38): `POST /servicios` pendiente no
 * asigna IP; `reservar-ip` la reserva en sitio; `activar-instalacion` la asigna con el router final;
 * la reserva vence a los 30 días.
 */

async function pendiente(client: any, token: string, extra: Record<string, unknown> = {}) {
    const escenario = await crearEscenarioRouter()
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila({ codigo_externo: `iris:prospecto:${randomUUID()}` }),
                router_id: escenario.routerId,
                plan_id: await crearPlanFila(),
                estado_inicial: 'pendiente_instalacion',
                ...extra,
            }),
        201,
    )
    return { servicio: r.body() as Record<string, any>, escenario }
}

const asignacionCambiada = (servicioId: number) =>
    db
        .from('audit.outbox')
        .where('evento', 'asignacion.cambiada')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')

const clave = () => `prueba:${randomUUID()}`

test.group('Pendiente sin IP (A38)', (group) => {
    group.setup(limpiarClavesAaa)

    test('el alta pendiente no asigna IP ni emite asignacion.cambiada; activar la asigna', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        assert.isNull(servicio.ipv4)
        assert.lengthOf(await asignacionCambiada(servicio.id), 0)

        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/activar-instalacion`)
                .bearerToken(token)
                .header('Idempotency-Key', clave())
                .json({}),
            200,
        )
        assert.equal(r.body().estado, 'activo')
        assert.isString(r.body().ipv4)
        assert.isString(r.body().prefijo_delegado_v6)
        const eventos = await asignacionCambiada(servicio.id)
        assert.lengthOf(eventos, 1)
        assert.deepEqual(eventos[0].payload.ipv4, [r.body().ipv4])
    })

    test('editar un pendiente sin IP no le asigna una', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio } = await pendiente(client, token)
        const r = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: servicio.version, direccion: 'Zona 1' }),
            200,
        )
        assert.isNull(r.body().ipv4)
    })

    test('reservar-ip: misma reserva en la segunda llamada, la activación la usa; 422 fuera de pendiente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        const reservar = () =>
            client
                .post(`/api/v1/servicios/${servicio.id}/reservar-ip`)
                .bearerToken(token)
                .json({ origen_tipo: 'iris_orden', origen_id: '9123' })
        const primera = await estado(reservar(), 200)
        assert.isString(primera.body().ipv4)
        assert.isString(primera.body().prefijo_v6)
        assert.isString(primera.body().vence_en)
        const segunda = await estado(reservar(), 200)
        assert.deepEqual(segunda.body(), primera.body())
        assert.lengthOf(await asignacionCambiada(servicio.id), 1)

        const activado = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/activar-instalacion`)
                .bearerToken(token)
                .header('Idempotency-Key', clave())
                .json({}),
            200,
        )
        assert.equal(activado.body().ipv4, primera.body().ipv4)
        assert.lengthOf(await asignacionCambiada(servicio.id), 1)
        const fila = await db.from('core.servicios').where('id', servicio.id).first()
        assert.isNull(fila.ip_reservada_en)

        const fuera = await reservar()
        fuera.assertStatus(422)
        assert.equal(fuera.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
    })

    test('reservar en otro router mueve el pendiente; sin IP libre es 422 sin_ip_disponible', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        const otro = await crearEscenarioRouter()
        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/reservar-ip`)
                .bearerToken(token)
                .json({ router_id: otro.routerId, origen_tipo: 'iris_orden', origen_id: '1' }),
            200,
        )
        assert.isTrue(r.body().ipv4.startsWith(`${otro.base}.`))
        const movido = await db.from('core.servicios').where('id', servicio.id).first()
        assert.equal(Number(movido.router_id), otro.routerId)

        // un router sin redes ni pool: no hay de dónde sacar la IP
        const vacio = await db
            .table('network.routers')
            .insert({
                nombre: `R-${randomUUID().slice(0, 8)}`,
                host: '192.0.2.1',
                nas_ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
            })
            .returning('id')
        const { servicio: otroPendiente } = await pendiente(client, token)
        const sin = await client
            .post(`/api/v1/servicios/${otroPendiente.id}/reservar-ip`)
            .bearerToken(token)
            .json({ router_id: vacio[0].id, origen_tipo: 'iris_orden', origen_id: '2' })
        sin.assertStatus(422)
        assert.equal(sin.body().type, 'urn:argosisp:problema:sin_ip_disponible')
    })

    test('Iris: X-Iris-Actor, nunca el asistente y solo servicios de Iris (403 servicio_no_de_iris)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        const ajeno = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: servicio.router_id,
                    plan_id: servicio.plan_id,
                    estado_inicial: 'pendiente_instalacion',
                }),
            201,
        )
        const iris = await tokenIris()
        const cuerpo = { origen_tipo: 'iris_orden', origen_id: '77' }
        const ia = await conActor(
            client.post(`/api/v1/servicios/${servicio.id}/reservar-ip`).bearerToken(iris),
            'asistente_ia',
        ).json(cuerpo)
        ia.assertStatus(403)
        assert.equal(ia.body().type, 'urn:argosisp:problema:actor_ia_no_permitido')
        const noDeIris = await conActor(
            client.post(`/api/v1/servicios/${ajeno.body().id}/reservar-ip`).bearerToken(iris),
        ).json(cuerpo)
        noDeIris.assertStatus(403)
        assert.equal(noDeIris.body().type, 'urn:argosisp:problema:servicio_no_de_iris')
        await estado(
            conActor(client.post(`/api/v1/servicios/${servicio.id}/reservar-ip`).bearerToken(iris)).json(
                cuerpo,
            ),
            200,
        )
        const origen = await db.from('core.servicios_origenes_iris').where('servicio_id', servicio.id)
        assert.deepEqual(
            origen.map((o) => o.origen_id),
            ['77'],
        )
    })

    test('la reserva vence a los 30 días sin activar (cron reservas_ip_vencidas)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/reservar-ip`)
                .bearerToken(token)
                .json({ origen_tipo: 'iris_orden', origen_id: '5' }),
            200,
        )
        const casi = await ejecutarCronCore('reservas_ip_vencidas', new Date(Date.now() + 29 * 86_400_000))
        assert.notInclude((casi.resultado as any).liberadas, servicio.id)
        const vencido = await ejecutarCronCore('reservas_ip_vencidas', new Date(Date.now() + 31 * 86_400_000))
        assert.include((vencido.resultado as any).liberadas, servicio.id)
        const vista = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.isNull(vista.body().ipv4)
        const eventos = await asignacionCambiada(servicio.id)
        assert.deepEqual(eventos.at(-1)!.payload.ipv4, [])
    })
})
