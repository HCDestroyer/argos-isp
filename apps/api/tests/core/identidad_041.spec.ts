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
    conectorIris,
    dpiUnico,
    jpeg,
    multipart,
    tokenIris,
} from '#tests/core/ayudas_iris_0100'
import { ejecutarCronCore } from '#core/jobs'
import { registrarEnvioIris } from '#integraciones/iris/envios'

/**
 * Identidad del titular (contrato Iris 0.10.0 §3.4.3, A41).
 */

async function pendienteDeIris(client: any, token: string, datosCliente: Record<string, unknown> = {}) {
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

const registrar = (
    client: any,
    token: string,
    clienteId: number,
    campos: Record<string, string>,
    fotos: Record<string, Buffer>,
    clave = `iris:identidad:${randomUUID()}:1`,
) =>
    multipart(
        conActor(
            client
                .post(`/api/v1/clientes/${clienteId}/identidad`)
                .bearerToken(token)
                .header('Idempotency-Key', clave),
        ),
        campos,
        fotos,
    )

test.group('Identidad del titular (A41)', () => {
    test('registra cifrada, idempotente por clave y bytes; versión vigente y anterior', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { clienteId } = await pendienteDeIris(client, tecnico)
        const iris = await tokenIris()
        const campos = camposIdentidad()
        const clave = `iris:identidad:${randomUUID()}:1`
        const primera = await estado(
            registrar(client, iris, clienteId, campos, { frente: jpeg('a') }, clave),
            201,
        )
        assert.equal(primera.body().version, 1)
        const repetida = await estado(
            registrar(client, iris, clienteId, campos, { frente: jpeg('a') }, clave),
            201,
        )
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        assert.deepEqual(repetida.body(), primera.body())
        const otraFoto = await registrar(client, iris, clienteId, campos, { frente: jpeg('b') }, clave)
        otraFoto.assertStatus(422)
        assert.equal(otraFoto.body().type, 'urn:argosisp:problema:idempotency_key_reutilizada')

        const fila = await db
            .from('core.clientes_identidades')
            .where('id', primera.body().identidad_id)
            .first()
        assert.notInclude(fila.documento_cifrado, campos.documento_numero!)
        assert.notInclude(fila.nombre_cifrado, 'Ana')
        assert.isFalse(Buffer.from(fila.frente).includes(jpeg('a')))

        // tres versiones: quedan la vigente y la anterior
        await estado(
            registrar(client, iris, clienteId, campos, { frente: jpeg('c'), reverso: jpeg('d') }),
            201,
        )
        const tercera = await estado(registrar(client, iris, clienteId, campos, { frente: jpeg('e') }), 201)
        assert.equal(tercera.body().version, 3)
        const versiones = await db
            .from('core.clientes_identidades')
            .where('cliente_id', clienteId)
            .orderBy('version')
        assert.deepEqual(
            versiones.map((v) => [v.version, v.vigente]),
            [
                [2, false],
                [3, true],
            ],
        )

        // auditoría y evento sin número, nombre ni foto
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'clientes.registrar_identidad', entidad_id: clienteId, resultado: 'ok' })
        const texto = JSON.stringify(auditoria.map((a) => a.entrada))
        assert.notInclude(texto, campos.documento_numero!)
        assert.notInclude(texto, 'Ana Pérez')
        assert.equal(auditoria[0].iris_actor, 'usuario:op-1')
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'cliente.identidad_registrada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        assert.lengthOf(eventos, 3)
        assert.notInclude(JSON.stringify(eventos[0].payload), campos.documento_numero!)
        assert.equal(eventos[0].payload.documento_tipo, 'dpi')

        // nunca escribe nit_cui
        const cliente = await db.from('core.clientes').where('id', clienteId).first()
        assert.isNull(cliente.nit_cui)
    })

    test('validación sin repetir valores; 413, mime y mayor de edad', async ({ client, assert }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { clienteId } = await pendienteDeIris(client, tecnico)
        const iris = await tokenIris()
        const malo = await registrar(
            client,
            iris,
            clienteId,
            camposIdentidad({ documento_numero: '1234567890100' }),
            {
                frente: jpeg(),
            },
        )
        malo.assertStatus(422)
        assert.notInclude(JSON.stringify(malo.body()), '1234567890100')
        const menor = await registrar(client, iris, clienteId, camposIdentidad({ mayor_de_edad: 'false' }), {
            frente: jpeg(),
        })
        menor.assertStatus(422)
        const pdf = await registrar(client, iris, clienteId, camposIdentidad(), {
            frente: Buffer.from('%PDF-1.4 ...'),
        })
        pdf.assertStatus(422)
        assert.equal(pdf.body().type, 'urn:argosisp:problema:mime_no_permitido')
        const grande = await registrar(client, iris, clienteId, camposIdentidad(), {
            frente: Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024)]),
        })
        grande.assertStatus(413)
        assert.equal(grande.body().type, 'urn:argosisp:problema:tamano_excedido')
        const sinFrente = await registrar(client, iris, clienteId, camposIdentidad(), {})
        sinFrente.assertStatus(422)
    })

    test('solo clientes de un pendiente de Iris; nunca el asistente', async ({ client, assert }) => {
        const iris = await tokenIris()
        const sinPendiente = await crearClienteFila()
        const r = await registrar(client, iris, sinPendiente, camposIdentidad(), { frente: jpeg() })
        r.assertStatus(422)
        assert.equal(r.body().type, 'urn:argosisp:problema:cliente_sin_instalacion')

        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { clienteId } = await pendienteDeIris(client, tecnico)
        const ia = await multipart(
            conActor(
                client
                    .post(`/api/v1/clientes/${clienteId}/identidad`)
                    .bearerToken(iris)
                    .header('Idempotency-Key', randomUUID()),
                'asistente_ia',
            ),
            camposIdentidad(),
            { frente: jpeg() },
        )
        ia.assertStatus(403)
        assert.equal(ia.body().type, 'urn:argosisp:problema:actor_ia_no_permitido')
    })

    test('cliente con historial: documento y nombre deben coincidir', async ({ client, assert }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const dpi = dpiUnico()
        const { clienteId } = await pendienteDeIris(client, tecnico, {
            nombre: 'José Álvarez',
            tipo_documento_fiscal: 'cui',
            nit_cui: dpi,
        })
        await crearServicioFila({ cliente_id: clienteId, estado: 'activo' })
        const iris = await tokenIris()
        const otroNombre = await registrar(
            client,
            iris,
            clienteId,
            camposIdentidad({ documento_numero: dpi, nombre: 'Otra Persona' }),
            { frente: jpeg() },
        )
        otroNombre.assertStatus(422)
        assert.equal(otroNombre.body().type, 'urn:argosisp:problema:titular_no_coincide')
        await estado(
            registrar(
                client,
                iris,
                clienteId,
                camposIdentidad({ documento_numero: dpi, nombre: 'jose  alvarez' }),
                {
                    frente: jpeg(),
                },
            ),
            201,
        )
    })

    test('ver la identidad: solo clientes.ver_identidad, cada vista auditada; Iris nunca', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { clienteId } = await pendienteDeIris(client, tecnico)
        const iris = await tokenIris()
        const campos = camposIdentidad()
        const r = await estado(registrar(client, iris, clienteId, campos, { frente: jpeg('z') }), 201)
        const { token: admin } = await usuarioConRoles(['admin'])
        const vista = await estado(
            client.get(`/api/v1/clientes/${clienteId}/identidad`).bearerToken(admin),
            200,
        )
        assert.equal(vista.body().data[0].documento_numero, campos.documento_numero!)
        assert.equal(vista.body().data[0].nombre, 'Ana Pérez')
        const foto = await estado(
            client
                .get(`/api/v1/clientes/${clienteId}/identidad/${r.body().identidad_id}/frente`)
                .bearerToken(admin),
            200,
        )
        assert.equal(foto.header('content-type'), 'image/jpeg')
        const soporte = await usuarioConRoles(['soporte'])
        await estado(client.get(`/api/v1/clientes/${clienteId}/identidad`).bearerToken(soporte.token), 403)
        await estado(conActor(client.get(`/api/v1/clientes/${clienteId}/identidad`).bearerToken(iris)), 403)
        const vistas = await db
            .from('audit.acciones')
            .where({ accion: 'clientes.ver_identidad', entidad_id: clienteId, resultado: 'ok' })
        assert.lengthOf(vistas, 2)
    })

    test('se borra 12 meses después de retirado el cliente; webhook solo con contrato ≥ 0.10.0', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { clienteId, servicio } = await pendienteDeIris(client, tecnico)
        const iris = await tokenIris()
        await estado(registrar(client, iris, clienteId, camposIdentidad(), { frente: jpeg() }), 201)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'cliente.identidad_registrada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
            .first()
        await conectorIris('0.10.0')
        await registrarEnvioIris({ id: evento.id, evento: evento.evento, payload: evento.payload })
        const envio = await db
            .from('integraciones.iris_envios')
            .where('evento', 'cliente.identidad_registrada')
            .first()
        assert.deepEqual(JSON.parse(envio.cuerpo).payload, {
            cliente_id: clienteId,
            empresa_id: servicio.empresa_id,
            documento_tipo: 'dpi',
            metodo: 'foto_documento',
        })
        await db.from('integraciones.iris_conector').delete()

        await db.from('core.servicios').where('id', servicio.id).update({ estado: 'retirado' })
        const antes = await ejecutarCronCore('identidades_vencidas', new Date(Date.now() + 300 * 86_400_000))
        assert.notInclude((antes.resultado as any).clientes, clienteId)
        const despues = await ejecutarCronCore(
            'identidades_vencidas',
            new Date(Date.now() + 370 * 86_400_000),
        )
        assert.include((despues.resultado as any).clientes, clienteId)
        const filas = await db.from('core.clientes_identidades').where('cliente_id', clienteId)
        assert.lengthOf(filas, 0)
    })
})
