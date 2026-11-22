import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    escenario,
    estadoServicio,
    eventosDe,
    generar,
    servicioCortado,
    siguienteDeSecuencia,
} from '#tests/billing/ayudas_billing'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import CrearContactoCliente from '#core/actions/crear_contacto_cliente'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import RegistrarGestionCobro from '#billing/actions/registrar_gestion_cobro'

/**
 * Gestiones de cobro (decisión del PM 8, contrato Iris 0.13.0): `POST /clientes/:id/gestiones-cobro`
 * desde el panel y desde Iris, su listado, el adjunto y la evidencia del castigo de cartera.
 */

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
)

/** UUID v7 de prueba (versión 7, variante 10xx). */
function uuidV7(): string {
    const u = randomUUID().split('')
    u[14] = '7'
    u[19] = '9'
    return u.join('')
}

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

const haceUnRato = () => new Date(Date.now() - 60 * 60_000).toISOString()

test.group('billing · gestiones de cobro (decisión 8, Iris 0.13.0)', () => {
    test('panel: registra con nota, lista, adjunta una vez y no cambia el servicio ni las facturas', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const e = await servicioCortado()
        const antesEstado = await estadoServicio(e.servicioId)
        const facturasAntes = await db
            .from('billing.facturas')
            .where('servicio_id', e.servicioId)
            .select('estado', 'pagado')

        const r = await estado(
            client.post(`/api/v1/clientes/${e.clienteId}/gestiones-cobro`).bearerToken(token).json({
                tipo: 'carta',
                resultado: 'visita_sin_contacto',
                ocurrido_en: haceUnRato(),
                servicio_id: e.servicioId,
                nota: 'Se dejó la carta con el vecino',
            }),
            201,
        )
        const g = r.body()
        assert.equal(g.gestion_id, g.id)
        assert.equal(g.origen_tipo, 'panel')
        assert.isNull(g.sistema_origen)
        assert.equal(g.nota, 'Se dejó la carta con el vecino')
        assert.isFalse(g.repetida)

        // solo informativa
        assert.equal(await estadoServicio(e.servicioId), antesEstado)
        const facturasDespues = await db
            .from('billing.facturas')
            .where('servicio_id', e.servicioId)
            .select('estado', 'pagado')
        assert.deepEqual(facturasDespues, facturasAntes)

        const eventos = await eventosDe('gestion_cobro.registrada', 'gestion_id', g.id)
        assert.lengthOf(eventos, 1)
        assert.notProperty(eventos[0].payload, 'nota')
        assert.isNull(eventos[0].payload.origen)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'gestiones_cobro.registrar')
            .where('entidad_id', g.id)
            .first()
        assert.equal(accion.resultado, 'ok')

        const lista = await estado(
            client.get(`/api/v1/clientes/${e.clienteId}/gestiones-cobro`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((x: { id: number }) => x.id),
            [g.id],
        )

        const adj = await estado(
            client
                .post(`/api/v1/gestiones-cobro/${g.id}/adjunto`)
                .bearerToken(token)
                .file('archivo', PNG, { filename: 'carta.png' }),
            200,
        )
        assert.isTrue(adj.body().tiene_adjunto)
        assert.equal(adj.body().adjunto_tipo, 'image/png')
        const otra = await estado(
            client
                .post(`/api/v1/gestiones-cobro/${g.id}/adjunto`)
                .bearerToken(token)
                .file('archivo', PNG, { filename: 'otra.png' }),
            409,
        )
        assert.match(otra.body().type, /adjunto_existente$/)
        const archivo = await estado(
            client.get(`/api/v1/gestiones-cobro/${g.id}/adjunto`).bearerToken(token),
            200,
        )
        assert.equal(archivo.header('content-type'), 'image/png')
        assert.lengthOf(await eventosDe('gestion_cobro.adjunto_agregado', 'gestion_id', g.id), 1)

        // la base no deja editar ni borrar
        await assert.rejects(() =>
            db.from('billing.gestiones_cobro').where('id', g.id).update({ resultado: 'rechaza' }),
        )
        await assert.rejects(() => db.from('billing.gestiones_cobro').where('id', g.id).delete())
    })

    test('ventana de ocurrido_en, servicio de otro cliente y nota larga', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const e = await escenario()
        const otro = await escenario()
        const post = (cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/clientes/${e.clienteId}/gestiones-cobro`)
                .bearerToken(token)
                .json({ tipo: 'llamada', resultado: 'no_contesto', ocurrido_en: haceUnRato(), ...cuerpo })
        const vieja = await estado(
            post({ ocurrido_en: new Date(Date.now() - 8 * 86_400_000).toISOString() }),
            422,
        )
        assert.equal(vieja.body().errors[0].rule, 'fuera_de_ventana')
        const futura = await estado(
            post({ ocurrido_en: new Date(Date.now() + 10 * 60_000).toISOString() }),
            422,
        )
        assert.equal(futura.body().errors[0].rule, 'fuera_de_ventana')
        await estado(post({ ocurrido_en: new Date(Date.now() + 2 * 60_000).toISOString() }), 201)
        const ajeno = await estado(post({ servicio_id: otro.servicioId }), 422)
        assert.equal(ajeno.body().errors[0].rule, 'servicio_de_otro_cliente')
        await estado(post({ nota: 'x'.repeat(281) }), 422)
        // lectura sin permiso de registrar
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        await estado(
            client
                .post(`/api/v1/clientes/${e.clienteId}/gestiones-cobro`)
                .bearerToken(tecnico)
                .json({ tipo: 'llamada', resultado: 'contesto', ocurrido_en: haceUnRato() }),
            403,
        )
    })

    test('Iris: clave iris:gestion:<uuid v7>, X-Iris-Actor, replay, 422 con otro cuerpo, reglas solo de Argos y contacto', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const e = await escenario()
        await generar(e.servicioId, '2026-09-01')
        const gestionId = uuidV7()
        const cuerpo = {
            tipo: 'llamada',
            resultado: 'promete_pagar',
            ocurrido_en: haceUnRato(),
            origen_tipo: 'llamada',
            origen_id: 'llam-123',
            servicio_id: e.servicioId,
        }
        const post = (
            clave: string | null,
            datos: Record<string, unknown> = cuerpo,
            actor: string | null = 'usuario:op-7',
        ) => {
            const p = client
                .post(`/api/v1/clientes/${e.clienteId}/gestiones-cobro`)
                .bearerToken(iris)
                .json(datos)
            if (clave !== null) p.header('Idempotency-Key', clave)
            if (actor !== null) p.header('X-Iris-Actor', actor)
            return p
        }
        const sinActor = await estado(post(`iris:gestion:${gestionId}`, cuerpo, null), 400)
        assert.match(sinActor.body().type, /cabecera_iris_requerida$/)
        const sinClave = await estado(post(null), 400)
        assert.match(sinClave.body().type, /idempotency_key_requerida$/)
        const malClave = await estado(post('iris:gestion:no-es-uuid'), 422)
        assert.equal(malClave.body().errors[0].field, 'Idempotency-Key')
        const v4 = await estado(post(`iris:gestion:${randomUUID()}`), 422)
        assert.equal(v4.body().errors[0].rule, 'formato')

        const primera = await estado(post(`iris:gestion:${gestionId}`), 201)
        assert.equal(primera.body().sistema_origen, 'iris')
        assert.equal(primera.body().iris_gestion_id, gestionId)
        assert.equal(primera.body().iris_actor, 'usuario:op-7')
        const repetida = await estado(post(`iris:gestion:${gestionId}`), 201)
        assert.equal(repetida.body().gestion_id, primera.body().gestion_id)
        const cambiada = await estado(
            post(`iris:gestion:${gestionId}`, { ...cuerpo, resultado: 'rechaza' }),
            422,
        )
        assert.match(cambiada.body().type, /idempotency_key_reutilizada$/)
        assert.lengthOf(
            await eventosDe('gestion_cobro.registrada', 'gestion_id', primera.body().gestion_id),
            1,
        )
        const [evento] = await eventosDe('gestion_cobro.registrada', 'gestion_id', primera.body().gestion_id)
        assert.equal(evento.payload.origen, 'iris')

        const carta = await estado(post(`iris:gestion:${uuidV7()}`, { ...cuerpo, tipo: 'carta' }), 422)
        assert.equal(carta.body().errors[0].rule, 'solo_argos')
        const panel = await estado(post(`iris:gestion:${uuidV7()}`, { ...cuerpo, origen_tipo: 'panel' }), 422)
        assert.equal(panel.body().errors[0].rule, 'solo_argos')
        const nota = await estado(
            post(`iris:gestion:${uuidV7()}`, { ...cuerpo, nota: 'llamar al 5555-1234' }),
            422,
        )
        assert.equal(nota.body().errors[0].rule, 'nota_no_permitida')
        const sinOrigen = await estado(post(`iris:gestion:${uuidV7()}`, { ...cuerpo, origen_id: null }), 422)
        assert.equal(sinOrigen.body().errors[0].field, 'origen_id')

        // contacto: del cliente y con el servicio entre los suyos
        const n = await siguienteDeSecuencia('core.contactos_cliente')
        const c = await new CrearContactoCliente().execute(
            {
                cliente_id: e.clienteId,
                nombre: unico('Contacto'),
                relacion: 'familiar',
                servicios: null,
                permisos: {},
                telefonos: [{ numero: `+5025${String(n * 7919 + 1000000).slice(-7)}`, principal: true }],
            },
            contextoPrueba(),
        )
        const conContacto = await estado(
            post(`iris:gestion:${uuidV7()}`).header('X-Iris-Contacto', String(c.contacto_id)),
            201,
        )
        assert.equal(conContacto.body().contacto_id, Number(c.contacto_id))
        const ajeno = await escenario()
        const fuera = await estado(
            client
                .post(`/api/v1/clientes/${ajeno.clienteId}/gestiones-cobro`)
                .bearerToken(iris)
                .header('Idempotency-Key', `iris:gestion:${uuidV7()}`)
                .header('X-Iris-Actor', 'asistente_ia')
                .header('X-Iris-Contacto', String(c.contacto_id))
                .json({ ...cuerpo, servicio_id: ajeno.servicioId }),
            403,
        )
        assert.match(fuera.body().type, /servicio_fuera_del_contacto$/)
    })

    test('castigo de cartera: sin texto de evidencia usa las gestiones registradas y las muestra', async ({
        assert,
    }) => {
        const e = await servicioCortado()
        const facturas = (await db
            .from('billing.facturas')
            .where('servicio_id', e.servicioId)
            .orderBy('id')
            .select('id')) as Array<{ id: number }>
        // sin gestiones ni texto: 422
        await assert.rejects(
            () =>
                new CastigarCartera().execute(
                    { facturas: [facturas[0]!.id], motivo: 'Retirado sin pagar', evidencia: '' },
                    contextoPrueba(),
                ),
            /evidencia de la gestión/,
        )
        const { usuario } = await usuarioConRoles(['cajero'])
        for (const resultado of ['no_contesto', 'rechaza'] as const) {
            await new RegistrarGestionCobro().execute(
                {
                    cliente_id: e.clienteId,
                    tipo: 'llamada',
                    resultado,
                    ocurrido_en: new Date(),
                    servicio_id: e.servicioId,
                },
                { ...contextoPrueba(usuario.id), empresaId: 1 },
            )
        }
        const castigo = await new CastigarCartera().execute(
            { facturas: [facturas[0]!.id], motivo: 'Retirado sin pagar', evidencia: '' },
            contextoPrueba(),
        )
        assert.match(castigo.evidencia, /^2 gestiones de cobro registradas; última: \d{4}-\d{2}-\d{2}$/)
        assert.lengthOf(castigo.gestiones, 2)
        assert.deepEqual(castigo.gestiones.map((g) => g.resultado).sort(), ['no_contesto', 'rechaza'])
    })
})
