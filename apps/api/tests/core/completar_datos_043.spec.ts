import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'
import {
    camposIdentidad,
    conActor,
    jpeg,
    movilUnico,
    multipart,
    tokenIris,
} from '#tests/core/ayudas_iris_0100'

/** Completar los datos del titular y del lugar (contrato Iris 0.10.0 §3.4.6, A43). */

async function pendiente(client: any, token: string, datosCliente: Record<string, unknown> = {}) {
    const escenario = await crearEscenarioRouter()
    const clienteId = await crearClienteFila({
        codigo_externo: `iris:prospecto:${randomUUID()}`,
        ...datosCliente,
    })
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: escenario.routerId,
                plan_id: await crearPlanFila(),
                estado_inicial: 'pendiente_instalacion',
            }),
        201,
    )
    return { clienteId, servicio: r.body() as Record<string, any> }
}

const completar = (client: any, token: string, servicioId: number, cuerpo: Record<string, unknown>) =>
    conActor(client.post(`/api/v1/servicios/${servicioId}/completar-datos`).bearerToken(token)).json({
        origen_tipo: 'iris_orden',
        origen_id: '9123',
        ...cuerpo,
    })

test.group('Completar datos en la instalación (A43)', () => {
    test('llena vacíos del cliente y corrige el lugar; eventos solo con nombres de campo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { clienteId, servicio } = await pendiente(client, token)
        const iris = await tokenIris()
        const telefono = movilUnico()
        const r = await estado(
            completar(client, iris, servicio.id, {
                cliente: { telefono, whatsapp: true, tipo_documento_fiscal: 'cf', relacion: 'familiar' },
                servicio: { direccion: '3a calle 4-50', coordenadas: '14.6349,-90.5069', precision_m: 8.5 },
            }),
            200,
        )
        assert.equal(r.body().direccion, '3a calle 4-50')
        assert.equal(r.body().precision_m, 8.5)
        const cliente = await db.from('core.clientes').where('id', clienteId).first()
        assert.equal(cliente.telefono, `+502 ${telefono.slice(4, 8)}-${telefono.slice(8)}`)
        assert.equal(cliente.canal_preferido, 'whatsapp')
        assert.deepEqual(cliente.campos_sin_confirmar, ['telefono'])

        const actualizado = await db
            .from('audit.outbox')
            .where('evento', 'cliente.actualizado')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
            .first()
        assert.include(actualizado.payload.campos, 'telefono')
        const datos = await db
            .from('audit.outbox')
            .where('evento', 'servicio.datos_cambiados')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicio.id])
            .first()
        assert.sameMembers(datos.payload.campos, ['direccion', 'coordenadas', 'precision_m'])
        assert.equal(datos.payload.origen_id, '9123')
        assert.notInclude(JSON.stringify(datos.payload), '3a calle')

        const otraVez = await completar(client, iris, servicio.id, { cliente: { telefono: movilUnico() } })
        otraVez.assertStatus(422)
        assert.equal(otraVez.body().type, 'urn:argosisp:problema:campo_ya_registrado')
        assert.notInclude(JSON.stringify(otraVez.body()), telefono.slice(4))
    })

    test('el nombre solo se corrige con la identidad registrada', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { clienteId, servicio } = await pendiente(client, token, { nombre: 'Anita' })
        const iris = await tokenIris()
        const sinIdentidad = await completar(client, iris, servicio.id, { cliente: { nombre: 'Ana Pérez' } })
        sinIdentidad.assertStatus(422)
        assert.equal(sinIdentidad.body().type, 'urn:argosisp:problema:campo_ya_registrado')
        const identidad = await estado(
            multipart(
                conActor(
                    client
                        .post(`/api/v1/clientes/${clienteId}/identidad`)
                        .bearerToken(iris)
                        .header('Idempotency-Key', randomUUID()),
                ),
                camposIdentidad(),
                { frente: jpeg() },
            ),
            201,
        )
        const distinto = await completar(client, iris, servicio.id, {
            cliente: { nombre: 'Otra' },
            identidad_id: identidad.body().identidad_id,
        })
        distinto.assertStatus(422)
        await estado(
            completar(client, iris, servicio.id, {
                cliente: { nombre: 'Ana Pérez' },
                identidad_id: identidad.body().identidad_id,
            }),
            200,
        )
        const cliente = await db.from('core.clientes').where('id', clienteId).first()
        assert.equal(cliente.nombre, 'Ana Pérez')
    })

    test('cliente con historial: 422 cliente_con_historial; el lugar sí se corrige', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { clienteId, servicio } = await pendiente(client, token)
        await crearServicioFila({ cliente_id: clienteId, estado: 'activo' })
        const iris = await tokenIris()
        const r = await completar(client, iris, servicio.id, { cliente: { email: 'a@b.gt' } })
        r.assertStatus(422)
        assert.equal(r.body().type, 'urn:argosisp:problema:cliente_con_historial')
        await estado(completar(client, iris, servicio.id, { servicio: { referencia: 'Casa verde' } }), 200)
    })

    test('solo en pendiente y con NIT válido', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        const iris = await tokenIris()
        const nit = await completar(client, iris, servicio.id, {
            cliente: { tipo_documento_fiscal: 'nit', nit_cui: '1234567' },
        })
        nit.assertStatus(422)
        assert.notInclude(JSON.stringify(nit.body()), '1234567')
        await db
            .from('core.servicios')
            .where('id', servicio.id)
            .update({ estado: 'activo', instalado_en: new Date() })
        const activo = await completar(client, iris, servicio.id, { servicio: { referencia: 'x' } })
        activo.assertStatus(422)
        assert.equal(activo.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
    })
})
