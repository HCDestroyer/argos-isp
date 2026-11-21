import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import { comoCliente, conActor, conectorIris, movilUnico, tokenIris } from '#tests/core/ayudas_iris_0100'
import { registrarEnvioIris } from '#integraciones/iris/envios'
import { enmascararNumero, telefonosEnmascarados } from '#core/contactos'
import EditarCliente from '#core/actions/editar_cliente'

/**
 * Contactos del cliente (contrato Iris 0.10.0 §3.5, A42; 0.10.1 §3.8, A46) y
 * `telefonos_adicionales[]` de `POST /clientes` (§3.2).
 */

const clave = () => `prueba:${randomUUID()}`

async function crearContacto(client: any, token: string, clienteId: number, cuerpo: Record<string, unknown>) {
    return client
        .post(`/api/v1/clientes/${clienteId}/contactos`)
        .bearerToken(token)
        .header('Idempotency-Key', clave())
        .json(cuerpo)
}

async function eventos(clienteId: number) {
    return db
        .from('audit.outbox')
        .where('evento', 'cliente.contactos_cambiados')
        .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        .orderBy('id')
}

test.group('Contactos del cliente (A42)', (group) => {
    group.each.teardown(async () => {
        delete process.env.CONTACTOS_LIMITE_ACTOR
        delete process.env.CONTACTOS_LIMITE_TOKEN
    })

    test('todo cliente nace con su contacto titular; POST /clientes guarda los números adicionales', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const adicional = movilUnico()
        await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Marta López', telefonos_adicionales: [{ numero: 'x12' }] }),
            422,
        )
        const r = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({
                    nombre: 'Marta López',
                    telefono: movilUnico(),
                    telefonos_adicionales: [{ numero: adicional, whatsapp: true }],
                }),
            201,
        )
        const lista = await estado(
            client.get(`/api/v1/clientes/${r.body().id}/contactos`).bearerToken(token),
            200,
        )
        const [titular] = lista.body().data
        assert.isTrue(titular.es_titular)
        assert.equal(titular.relacion, 'titular')
        assert.equal(titular.nombre, 'Marta López')
        assert.deepEqual(titular.telefonos, [
            { numero: adicional, whatsapp: true, principal: false, adicional: true },
        ])
        // una fila insertada directo (importador, fixture) también tiene titular
        const directo = await crearClienteFila()
        const filas = await db.from('core.contactos_cliente').where({ cliente_id: directo, es_titular: true })
        assert.lengthOf(filas, 1)
    })

    test('crear, editar con version y quitar; nunca un segundo titular; eventos sin números', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clienteId = await crearClienteFila()
        const servicioId = await crearServicioFila({ cliente_id: clienteId })
        const numero = movilUnico()

        const titular = await crearContacto(client, token, clienteId, {
            nombre: 'Otro',
            relacion: 'titular',
            telefonos: [{ numero }],
        })
        titular.assertStatus(422)
        assert.equal(titular.body().type, 'urn:argosisp:problema:contacto_titular_no_permitido')

        const invalido = await crearContacto(client, token, clienteId, {
            nombre: 'Luis',
            relacion: 'familiar',
            telefonos: [{ numero: '12345678' }],
        })
        invalido.assertStatus(422)
        assert.notInclude(JSON.stringify(invalido.body()), '12345678')

        const r = await crearContacto(client, token, clienteId, {
            nombre: 'Luis Pérez',
            relacion: 'familiar',
            servicios: [servicioId],
            permisos: { avisos: false },
            telefonos: [{ numero, whatsapp: true }],
        })
        r.assertStatus(201)
        const contacto = r.body()
        assert.deepEqual(contacto.permisos, { consultar: true, reportar: true, pagar: true, avisos: false })
        assert.deepEqual(contacto.servicios, [servicioId])
        assert.equal(contacto.telefonos[0].principal, true)

        const ajeno = await crearServicioFila({ cliente_id: await crearClienteFila() })
        const fuera = await crearContacto(client, token, clienteId, {
            nombre: 'Ana',
            relacion: 'otro',
            servicios: [ajeno],
            telefonos: [{ numero: movilUnico() }],
        })
        fuera.assertStatus(422)

        const editar = (version: number) =>
            client
                .put(`/api/v1/contactos/${contacto.contacto_id}`)
                .bearerToken(token)
                .header('Idempotency-Key', clave())
                .json({
                    version,
                    relacion: 'inquilino',
                    telefonos: [{ numero, principal: true }, { numero: movilUnico() }],
                })
        const editado = await estado(editar(contacto.version), 200)
        assert.equal(editado.body().relacion, 'inquilino')
        assert.lengthOf(editado.body().telefonos, 2)
        const viejo = await editar(contacto.version)
        viejo.assertStatus(409)
        assert.equal(viejo.body().type, 'urn:argosisp:problema:conflicto_version')

        const quitar = await estado(
            client
                .delete(`/api/v1/contactos/${contacto.contacto_id}`)
                .bearerToken(token)
                .header('Idempotency-Key', clave())
                .json({ version: editado.body().version }),
            200,
        )
        assert.equal(quitar.body().contacto_id, contacto.contacto_id)
        const despues = await estado(
            client.get(`/api/v1/clientes/${clienteId}/contactos`).bearerToken(token),
            200,
        )
        assert.lengthOf(despues.body().data, 1)

        const titularId = despues.body().data[0].contacto_id
        const sinQuitar = await client
            .delete(`/api/v1/contactos/${titularId}`)
            .bearerToken(token)
            .header('Idempotency-Key', clave())
            .json({ version: despues.body().data[0].version })
        sinQuitar.assertStatus(422)
        assert.equal(sinQuitar.body().type, 'urn:argosisp:problema:contacto_titular')

        const ev = await eventos(clienteId)
        assert.deepEqual(
            ev.map((e) => e.payload.accion),
            ['creado', 'editado', 'quitado'],
        )
        assert.equal(ev[0].payload.numeros_agregados, 1)
        assert.equal(ev[1].payload.numeros_agregados, 1)
        assert.notInclude(JSON.stringify(ev.map((e) => e.payload)), numero.slice(4))
        const auditoria = await db.from('audit.acciones').where({
            accion: 'contactos.gestionar',
            entidad_tipo: 'contacto_cliente',
            entidad_id: contacto.contacto_id,
        })
        // tres que salieron bien y el 409 (los errores también se auditan)
        assert.deepEqual(
            auditoria.map((a) => a.resultado),
            ['ok', 'ok', 'error', 'ok'],
        )
        assert.deepEqual(await telefonosEnmascarados(contacto.contacto_id), [
            enmascararNumero(numero),
            enmascararNumero(editado.body().telefonos[1].numero),
        ])
        assert.match(enmascararNumero('+50255123344'), /^\+502 \*\*\*\*-3344$/)
    })

    test('Idempotency-Key obligatoria; un cajero no gestiona contactos', async ({ client }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clienteId = await crearClienteFila()
        const sinClave = await client
            .post(`/api/v1/clientes/${clienteId}/contactos`)
            .bearerToken(token)
            .json({ nombre: 'Luis', relacion: 'familiar', telefonos: [{ numero: movilUnico() }] })
        sinClave.assertStatus(400)
        const cajero = await usuarioConRoles(['cajero'])
        const r = await crearContacto(client, cajero.token, clienteId, {
            nombre: 'Luis',
            relacion: 'familiar',
            telefonos: [{ numero: movilUnico() }],
        })
        r.assertStatus(403)
    })

    test('buscar por teléfono: titular, adicional y a cargo; nunca números ni documentos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const numero = movilUnico()
        const titularId = await crearClienteFila({
            nombre: 'Mamá',
            telefono: comoCliente(numero),
            nit_cui: '1234567890101',
        })
        await crearServicioFila({ cliente_id: titularId })
        const otroId = await crearClienteFila({ nombre: 'Dueña' })
        await crearServicioFila({ cliente_id: otroId })
        const encargado = await crearContacto(client, token, otroId, {
            nombre: 'Encargado',
            relacion: 'empleado',
            telefonos: [{ numero }],
        })
        encargado.assertStatus(201)
        const terceroId = await crearClienteFila()
        const adicional = await client
            .post('/api/v1/clientes')
            .bearerToken(token)
            .json({ nombre: 'Con adicional', telefonos_adicionales: [{ numero }] })
        adicional.assertStatus(201)

        const r = await estado(
            client.get('/api/v1/contactos/buscar').qs({ telefono: numero }).bearerToken(token),
            200,
        )
        const filas = r.body() as any[]
        const porCliente = new Map(filas.map((f) => [f.cliente_id, f]))
        assert.isTrue(porCliente.get(titularId).es_titular)
        assert.isFalse(porCliente.get(titularId).adicional)
        assert.isFalse(porCliente.get(titularId).a_cargo)
        assert.isTrue(porCliente.get(otroId).a_cargo)
        assert.equal(porCliente.get(otroId).relacion, 'empleado')
        assert.isTrue(porCliente.get(adicional.body().id).adicional)
        assert.isFalse(porCliente.has(terceroId))
        const texto = JSON.stringify(filas)
        assert.notInclude(texto, numero.slice(4))
        assert.notInclude(texto, '1234567890101')
        assert.notProperty(filas[0], 'telefonos')

        const fila = await db
            .from('audit.acciones')
            .where('accion', 'contactos.buscar')
            .orderBy('id', 'desc')
            .first()
        assert.equal(fila.entrada.telefono, '***')
        assert.equal(fila.entrada.auditoria.telefono, enmascararNumero(numero))
    })

    test('Iris: X-Iris-Actor obligatoria, límite por actor y nunca el asistente gestiona', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const clienteId = await crearClienteFila()
        const numero = movilUnico()
        const sin = await client.get('/api/v1/contactos/buscar').qs({ telefono: numero }).bearerToken(token)
        sin.assertStatus(400)
        assert.equal(sin.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')

        process.env.CONTACTOS_LIMITE_ACTOR = '2'
        const actor = `usuario:op-${randomUUID().slice(0, 8)}`
        const buscar = () =>
            conActor(
                client.get('/api/v1/contactos/buscar').qs({ telefono: numero }).bearerToken(token),
                actor,
            )
        await estado(buscar(), 200)
        await estado(buscar(), 200)
        const tercera = await buscar()
        tercera.assertStatus(429)
        assert.equal(tercera.body().type, 'urn:argosisp:problema:demasiadas_busquedas')
        assert.isAbove(Number(tercera.header('retry-after')), 0)

        const ia = await conActor(
            client
                .post(`/api/v1/clientes/${clienteId}/contactos`)
                .bearerToken(token)
                .header('Idempotency-Key', clave()),
            'asistente_ia',
        ).json({ nombre: 'Luis', relacion: 'familiar', telefonos: [{ numero }] })
        ia.assertStatus(403)
        assert.equal(ia.body().type, 'urn:argosisp:problema:actor_ia_no_permitido')

        const creado = await conActor(
            client
                .post(`/api/v1/clientes/${clienteId}/contactos`)
                .bearerToken(token)
                .header('Idempotency-Key', clave()),
        ).json({ nombre: 'Luis', relacion: 'familiar', telefonos: [{ numero }] })
        creado.assertStatus(201)
        assert.equal(creado.body().origen, 'iris')
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'contactos.gestionar', entidad_id: creado.body().contacto_id })
            .first()
        assert.equal(accion.iris_actor, 'usuario:op-1')
        assert.equal(accion.canal, 'api')

        // Iris no toca el contacto titular
        const titular = await db
            .from('core.contactos_cliente')
            .where({ cliente_id: clienteId, es_titular: true })
            .first()
        const put = await conActor(
            client
                .put(`/api/v1/contactos/${titular.id}`)
                .bearerToken(token)
                .header('Idempotency-Key', clave()),
        ).json({ version: titular.version, permisos: { avisos: false } })
        put.assertStatus(422)
        assert.equal(put.body().type, 'urn:argosisp:problema:contacto_titular_no_permitido')
    })

    test('webhook cliente.contactos_cambiados solo a conectores con contrato ≥ 0.10.0, sin números', async ({
        assert,
    }) => {
        await tokenIris()
        const clienteId = await crearClienteFila()
        await crearServicioFila({ cliente_id: clienteId })
        const payload = {
            cliente_id: clienteId,
            empresa_id: 1,
            contacto_id: 77,
            accion: 'creado',
            campos: ['nombre', 'telefonos'],
            persona_cliente_id: null,
            numeros_agregados: 1,
        }
        const [{ id }] = (await db
            .table('audit.outbox')
            .insert({
                evento: 'cliente.contactos_cambiados',
                payload: JSON.stringify(payload),
                request_id: randomUUID(),
            })
            .returning('id')) as Array<{ id: number }>
        await conectorIris('0.9.0')
        assert.isNull(await registrarEnvioIris({ id, evento: 'cliente.contactos_cambiados', payload }))
        await conectorIris('0.10.0')
        assert.isNotNull(await registrarEnvioIris({ id, evento: 'cliente.contactos_cambiados', payload }))
        const envio = await db
            .from('integraciones.iris_envios')
            .where('evento', 'cliente.contactos_cambiados')
            .first()
        assert.deepEqual(JSON.parse(envio.cuerpo).payload, {
            cliente_id: clienteId,
            empresa_id: 1,
            contacto_id: 77,
            accion: 'creado',
            campos: ['nombre', 'telefonos'],
            persona_cliente_id: null,
        })
        await db.from('integraciones.iris_conector').delete()
    })
})

test.group('Contactos a cargo de otro cliente (A46)', () => {
    test('vincular con otro cliente de la misma empresa; desde Iris solo con número verificado', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const numero = movilUnico()
        const mamaId = await crearClienteFila({ nombre: 'Mamá' })
        await crearServicioFila({ cliente_id: mamaId })
        const joseId = await crearClienteFila({ nombre: 'José', telefono: comoCliente(numero) })
        await crearServicioFila({ cliente_id: joseId })

        const mismo = await crearContacto(client, token, mamaId, {
            nombre: 'José',
            relacion: 'familiar',
            telefonos: [{ numero }],
            persona_cliente_id: mamaId,
        })
        mismo.assertStatus(422)

        const iris = await tokenIris()
        const sinVerificar = await conActor(
            client
                .post(`/api/v1/clientes/${mamaId}/contactos`)
                .bearerToken(iris)
                .header('Idempotency-Key', clave()),
        ).json({ nombre: 'José', relacion: 'familiar', telefonos: [{ numero }], persona_cliente_id: joseId })
        sinVerificar.assertStatus(201)
        assert.isNull(sinVerificar.body().persona_cliente_id)

        await db.from('core.clientes').where('id', joseId).update({ telefono_verificado_en: new Date() })
        const verificado = await conActor(
            client
                .post(`/api/v1/clientes/${mamaId}/contactos`)
                .bearerToken(iris)
                .header('Idempotency-Key', clave()),
        ).json({ nombre: 'José', relacion: 'familiar', telefonos: [{ numero }], persona_cliente_id: joseId })
        verificado.assertStatus(201)
        assert.equal(verificado.body().persona_cliente_id, joseId)

        const aCargo = await estado(client.get(`/api/v1/clientes/${joseId}/a-cargo`).bearerToken(token), 200)
        assert.deepEqual(
            aCargo.body().data.map((c: any) => c.contacto_id),
            [verificado.body().contacto_id],
        )

        // cambiar el teléfono de José rompe el vínculo y emite el evento con vinculo_roto
        const jose = await db.from('core.clientes').where('id', joseId).first()
        await new EditarCliente().execute(
            { id: joseId, version: jose.version, telefono: movilUnico() },
            contextoPrueba(),
        )
        const contacto = await db
            .from('core.contactos_cliente')
            .where('id', verificado.body().contacto_id)
            .first()
        assert.isNull(contacto.persona_cliente_id)
        const roto = await db
            .from('audit.outbox')
            .where('evento', 'cliente.contactos_cambiados')
            .whereRaw(`payload->>'motivo' = 'vinculo_roto'`)
            .whereRaw(`(payload->>'contacto_id')::bigint = ?`, [contacto.id])
            .first()
        assert.equal(roto.payload.persona_anterior_id, joseId)
        const despues = await db.from('core.clientes').where('id', joseId).first()
        assert.isNull(despues.telefono_verificado_en)
    })
})
