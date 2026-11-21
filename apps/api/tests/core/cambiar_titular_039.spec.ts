import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { prefijoColas } from '#shared/redis'
import { estado, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'
import { conActor, dpiUnico, jpeg, movilUnico, tokenIris } from '#tests/core/ayudas_iris_0100'
import { PERMISOS_IRIS, PERMISOS_IRIS_0100 } from '#core/integraciones_iris'

/** Cambiar el titular de un pendiente (contrato Iris 0.10.0 §3.4.4, A39; decisión 9 del PM). */

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

function datos(extra: { cliente?: Record<string, unknown>; [k: string]: unknown } = {}) {
    const { cliente, ...resto } = extra
    return {
        cliente: {
            nombre: 'Ana Pérez',
            documento_tipo: 'dpi',
            documento_numero: dpiUnico(),
            mayor_de_edad: true,
            telefono: movilUnico(),
            whatsapp: true,
            email: null,
            tipo_documento_fiscal: 'cf',
            nit_cui: null,
            relacion: 'familiar',
            ...cliente,
        },
        identidad: {
            coincide: true,
            verificado_en: new Date(Date.now() - 60_000).toISOString(),
            metodo: 'foto_documento',
        },
        motivo_codigo: 'menor_de_edad',
        motivo: 'El servicio lo pidió un menor; queda de titular su madre',
        origen_tipo: 'iris_orden',
        origen_id: '9123',
        ...resto,
    }
}

function cambiar(
    client: any,
    token: string,
    servicioId: number,
    cuerpo: unknown,
    fotos: Record<string, Buffer> = { frente: jpeg() },
    actor = 'usuario:op-1',
) {
    const peticion = conActor(
        client
            .post(`/api/v1/servicios/${servicioId}/cambiar-titular`)
            .bearerToken(token)
            .header('Idempotency-Key', `iris:titular:${randomUUID()}`),
        actor,
    )
    peticion.field('datos', JSON.stringify(cuerpo))
    for (const [nombre, contenido] of Object.entries(fotos)) {
        peticion.file(nombre, contenido, { filename: `${nombre}.jpg` })
    }
    return peticion
}

async function limpiarLimites() {
    const claves = await redis().keys(`${prefijoColas()}:limite:titular:*`)
    if (claves.length > 0) await redis().del(...claves)
}

test.group('Cambiar el titular de un pendiente (A39)', (group) => {
    group.each.setup(limpiarLimites)

    test('titular nuevo: crea el cliente, mueve el servicio y elimina al anterior sin historial', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { clienteId, servicio } = await pendiente(client, token)
        const iris = await tokenIris()
        const r = await estado(cambiar(client, iris, servicio.id, datos()), 200)
        const cuerpo = r.body()
        assert.isFalse(cuerpo.titular.existente)
        assert.notEqual(cuerpo.titular.cliente_id, clienteId)
        assert.equal(cuerpo.de_cliente_id, clienteId)
        assert.isTrue(cuerpo.de_cliente_eliminado)
        assert.isFalse(cuerpo.posible_duplicado)
        assert.isNull(await db.from('core.clientes').where('id', clienteId).first())
        const movido = await db.from('core.servicios').where('id', servicio.id).first()
        assert.equal(Number(movido.cliente_id), cuerpo.titular.cliente_id)
        assert.equal(movido.user_ppp, servicio.user_ppp)

        const evento = await db
            .from('audit.outbox')
            .where('evento', 'servicio.titular_cambiado')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicio.id])
            .first()
        assert.equal(evento.payload.motivo_codigo, 'menor_de_edad')
        assert.isTrue(evento.payload.de_cliente_eliminado)
        assert.notProperty(evento.payload, 'motivo')
        const identidad = await db
            .from('audit.outbox')
            .where('evento', 'cliente.identidad_registrada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [cuerpo.titular.cliente_id])
            .first()
        assert.equal(identidad.payload.identidad_id, cuerpo.identidad_id)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.cambiar_titular', entidad_id: servicio.id, resultado: 'ok' })
            .first()
        assert.equal(accion.entrada.motivo, 'El servicio lo pidió un menor; queda de titular su madre')
        assert.equal(accion.entrada.cliente, '***')
    })

    test('titular existente (documento y nombre): se asigna al momento; otro nombre es 422 titular_no_coincide', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const dpi = dpiUnico()
        const madre = await crearClienteFila({
            nombre: 'María López',
            tipo_documento_fiscal: 'cui',
            nit_cui: dpi,
        })
        await crearServicioFila({ cliente_id: madre, estado: 'activo' })
        const { servicio } = await pendiente(client, token)
        const iris = await tokenIris()

        const otro = await cambiar(
            client,
            iris,
            servicio.id,
            datos({ cliente: { nombre: 'Otra Persona', documento_numero: dpi } }),
        )
        otro.assertStatus(422)
        assert.equal(otro.body().type, 'urn:argosisp:problema:titular_no_coincide')
        assert.notInclude(JSON.stringify(otro.body()), 'María')
        assert.notInclude(JSON.stringify(otro.body()), String(madre))

        const r = await estado(
            cambiar(
                client,
                iris,
                servicio.id,
                datos({ cliente: { nombre: 'maria  LOPEZ', documento_numero: dpi } }),
            ),
            200,
        )
        assert.deepEqual(r.body().titular, { cliente_id: madre, existente: true })
        const versiones = await db.from('core.clientes_identidades').where('cliente_id', madre)
        assert.lengthOf(versiones, 1)
        const fila = await db.from('core.clientes').where('id', madre).first()
        assert.equal(fila.nombre, 'María López')

        const { token: admin } = await usuarioConRoles(['admin'])
        const reporte = await estado(
            client.get('/api/v1/reportes/titulares-iris').qs({ existente: true, limit: 100 }).bearerToken(admin),
            200,
        )
        const fila2 = reporte.body().data.find((c: any) => c.servicio_id === servicio.id)
        assert.equal(fila2.a_cliente_id, madre)
        assert.isTrue(fila2.existente)
    })

    test('evidencia, estado y límites (2 por servicio al día)', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { servicio } = await pendiente(client, token)
        const iris = await tokenIris()
        const sinFoto = await cambiar(client, iris, servicio.id, datos(), {})
        sinFoto.assertStatus(422)
        assert.equal(sinFoto.body().type, 'urn:argosisp:problema:evidencia_requerida')
        const sinCoincide = await cambiar(
            client,
            iris,
            servicio.id,
            datos({
                identidad: {
                    coincide: false,
                    verificado_en: new Date().toISOString(),
                    metodo: 'foto_documento',
                },
            }),
        )
        sinCoincide.assertStatus(422)
        assert.equal(sinCoincide.body().type, 'urn:argosisp:problema:evidencia_requerida')
        const corto = await cambiar(client, iris, servicio.id, datos({ motivo: 'corto' }))
        corto.assertStatus(422)

        await estado(cambiar(client, iris, servicio.id, datos()), 200)
        await estado(cambiar(client, iris, servicio.id, datos()), 200)
        const tercero = await cambiar(client, iris, servicio.id, datos())
        tercero.assertStatus(429)
        assert.equal(tercero.body().type, 'urn:argosisp:problema:demasiados_cambios_titular')
        assert.isAbove(Number(tercero.header('retry-after')), 0)

        await db
            .from('core.servicios')
            .where('id', servicio.id)
            .update({ estado: 'activo', instalado_en: new Date() })
        await limpiarLimites()
        const activo = await cambiar(client, iris, servicio.id, datos())
        activo.assertStatus(422)
        assert.equal(activo.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
    })

    test('posible duplicado por teléfono, nunca el asistente; permisos 0.10.0 del token de Iris', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const telefono = movilUnico()
        const otro = await crearClienteFila({
            nombre: 'Alguien',
            telefono: `+502 ${telefono.slice(4, 8)}-${telefono.slice(8)}`,
        })
        await crearServicioFila({ cliente_id: otro, estado: 'activo' })
        const { servicio } = await pendiente(client, token)
        const iris = await tokenIris()
        const ia = await cambiar(client, iris, servicio.id, datos(), { frente: jpeg() }, 'asistente_ia')
        ia.assertStatus(403)
        const r = await estado(cambiar(client, iris, servicio.id, datos({ cliente: { telefono } })), 200)
        assert.isTrue(r.body().posible_duplicado)
        assert.includeMembers([...PERMISOS_IRIS], [...PERMISOS_IRIS_0100])
    })
})
