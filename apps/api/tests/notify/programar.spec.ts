import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { errorDeSintaxis, renderizar } from '#notify/plantillas'
import { quetzales } from '#notify/formato'
import {
    CanalFalso,
    ColaFalsa,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
} from '#tests/notify/ayudas_notify'

test.group('notify · plantillas y formato', () => {
    test('renderiza Mustache en texto plano, sin escapar HTML', ({ assert }) => {
        const texto = renderizar('Hola {{cliente.nombre}}{{#vencida}} (vencida){{/vencida}}', {
            cliente: { nombre: 'Pérez & <Hijos>' },
            vencida: true,
        })
        assert.equal(texto, 'Hola Pérez & <Hijos> (vencida)')
    })

    test('detecta plantillas con sintaxis inválida', ({ assert }) => {
        assert.isNull(errorDeSintaxis('{{#a}}x{{/a}}'))
        assert.isString(errorDeSintaxis('{{#a}}sin cerrar'))
    })

    test('formatea quetzales con separador de miles y dos decimales', ({ assert }) => {
        assert.equal(quetzales('1234.5'), 'Q 1,234.50')
        assert.equal(quetzales('150'), 'Q 150.00')
        assert.equal(quetzales('-20.1'), '-Q 20.10')
        assert.equal(quetzales('1000000.00'), 'Q 1,000,000.00')
    })
})

test.group('notify · consumidor de eventos', (group) => {
    let correo: CanalFalso
    let telegram: CanalFalso

    group.each.setup(() => {
        correo = new CanalFalso('correo')
        telegram = new CanalFalso('telegram')
        registrarCanal('correo', correo)
        registrarCanal('telegram', telegram)
        return () => reiniciarCanales()
    })

    test('factura.emitida: registra el envío por correo con la plantilla renderizada y lo encola', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ nombre: 'Ana López', email: 'ana@prueba.local' })
        const servicioId = await crearServicio(clienteId)
        const facturaId = await crearFactura(clienteId, servicioId, { total: '1234.50', vence: '2026-10-15' })
        const payload = {
            factura_id: facturaId,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '1234.50',
            vence: '2026-10-15',
        }
        const outboxId = await eventoOutbox('factura.emitida', payload)
        const cola = new ColaFalsa()

        await new ConsumidorNotify(cola).procesar({ id: outboxId, evento: 'factura.emitida', payload })

        const envios = await db.from('notify.envios').where('origen', `outbox:${outboxId}`)
        assert.lengthOf(envios, 1)
        const envio = envios[0]
        assert.containsSubset(envio, {
            cliente_id: clienteId,
            evento: 'factura.emitida',
            canal: 'correo',
            destino: 'ana@prueba.local',
            estado: 'encolado',
            intentos: 0,
        })
        assert.equal(envio.asunto, `Factura ${facturaId} por Q 1,234.50`)
        assert.include(envio.cuerpo, 'Hola Ana López:')
        assert.include(envio.cuerpo, 'del periodo octubre 2026 por Q 1,234.50. Vence el 15/10/2026.')
        assert.deepEqual(cola.ids, [envio.id])

        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.programar')
            .where('entidad_id', clienteId)
        assert.lengthOf(acciones, 1)
        assert.equal(acciones[0].resultado, 'ok')
    })

    test('el mismo evento entregado dos veces no crea otro envío', async ({ assert }) => {
        const clienteId = await crearCliente()
        const payload = {
            cliente_id: clienteId,
            factura_id: 999_999,
            servicio_id: null,
            total: '10.00',
            vence: '2026-11-01',
        }
        const outboxId = await eventoOutbox('factura.vencida', payload)
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorNotify(cola)

        await consumidor.procesar({ id: outboxId, evento: 'factura.vencida', payload })
        await consumidor.procesar({ id: outboxId, evento: 'factura.vencida', payload })

        const envios = await db.from('notify.envios').where('origen', `outbox:${outboxId}`)
        assert.lengthOf(envios, 1)
        // sigue encolado: se vuelve a encolar con el mismo id (BullMQ deduplica por jobId)
        assert.deepEqual(cola.ids, [envios[0].id, envios[0].id])

        await db.from('notify.envios').where('id', envios[0].id).update({ estado: 'enviado' })
        await consumidor.procesar({ id: outboxId, evento: 'factura.vencida', payload })
        assert.lengthOf(cola.ids, 2)
    })

    test('preferencia telegram con chat vinculado: envía por telegram', async ({ assert }) => {
        const clienteId = await crearCliente({ canal_preferido: 'telegram', telegram_chat_id: '555111' })
        const payload = {
            cliente_id: clienteId,
            factura_id: 999_998,
            servicio_id: null,
            total: '75.00',
            vence: '2026-10-20',
        }
        const outboxId = await eventoOutbox('factura.emitida', payload)

        await new ConsumidorNotify(new ColaFalsa()).procesar({
            id: outboxId,
            evento: 'factura.emitida',
            payload,
        })

        const envio = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).firstOrFail()
        assert.equal(envio.canal, 'telegram')
        assert.equal(envio.destino, '555111')
        assert.isNull(envio.asunto)
        assert.match(envio.cuerpo, /^Factura \d+ por Q 75\.00\n\n/)
    })

    test('fallback a correo: telegram sin chat, whatsapp sin adaptador o telegram sin plantilla activa', async ({
        assert,
    }) => {
        const sinChat = await crearCliente({ canal_preferido: 'telegram', telegram_chat_id: null })
        const whatsapp = await crearCliente({ canal_preferido: 'whatsapp' })
        const consumidor = new ConsumidorNotify(new ColaFalsa())

        for (const clienteId of [sinChat, whatsapp]) {
            const payload = {
                pago_id: 1,
                cliente_id: clienteId,
                monto: '50.00',
                metodo: 'caja',
                facturas: [],
            }
            const outboxId = await eventoOutbox('pago.registrado', payload)
            await consumidor.procesar({ id: outboxId, evento: 'pago.registrado', payload })
            const envio = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).firstOrFail()
            assert.equal(envio.canal, 'correo')
            assert.equal(envio.asunto, 'Pago recibido: Q 50.00')
        }

        const conChat = await crearCliente({ canal_preferido: 'telegram', telegram_chat_id: '777' })
        const plantilla = await db
            .from('notify.plantillas')
            .where({ evento: 'promesa.cumplida', canal: 'telegram' })
            .firstOrFail()
        await db.from('notify.plantillas').where('id', plantilla.id).update({ activa: false })
        try {
            const servicioId = await crearServicio(conChat)
            const payload = {
                promesa_id: 1,
                servicio_id: servicioId,
                vence: '2026-10-20T06:00:00Z',
                monto: '80.00',
            }
            const outboxId = await eventoOutbox('promesa.cumplida', payload)
            await consumidor.procesar({ id: outboxId, evento: 'promesa.cumplida', payload })
            const envio = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).firstOrFail()
            assert.equal(envio.cliente_id, conChat)
            assert.equal(envio.canal, 'correo')
        } finally {
            await db.from('notify.plantillas').where('id', plantilla.id).update({ activa: true })
        }
    })

    test('cliente sin destino: queda un envío fallido y se emite notificacion.enviada fallido', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ email: null })
        const servicioId = await crearServicio(clienteId)
        const payload = { servicio_id: servicioId, de: 'activo', a: 'suspendido', motivo: 'mora' }
        const outboxId = await eventoOutbox('servicio.estado_cambiado', payload)
        const cola = new ColaFalsa()

        await new ConsumidorNotify(cola).procesar({
            id: outboxId,
            evento: 'servicio.estado_cambiado',
            payload,
        })

        const envio = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).firstOrFail()
        assert.containsSubset(envio, {
            cliente_id: clienteId,
            canal: 'correo',
            estado: 'fallido',
            destino: '-',
        })
        assert.include(envio.error, 'no tiene destino')
        assert.equal(envio.asunto, 'Servicio suspendido')
        assert.deepEqual(cola.ids, [])

        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        assert.lengthOf(eventos, 1)
        assert.deepEqual(eventos[0].payload, {
            cliente_id: clienteId,
            canal: 'correo',
            evento_origen: 'servicio.estado_cambiado',
            estado: 'fallido',
        })
    })

    test('servicio.estado_cambiado resuelve el cliente por el servicio y elige el texto por estado', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const servicioId = await crearServicio(clienteId, 'Plan Hogar 20')
        const payload = { servicio_id: servicioId, de: 'suspendido', a: 'activo', motivo: 'pago' }
        const outboxId = await eventoOutbox('servicio.estado_cambiado', payload)

        await new ConsumidorNotify(new ColaFalsa()).procesar({
            id: outboxId,
            evento: 'servicio.estado_cambiado',
            payload,
        })

        const envio = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).firstOrFail()
        assert.equal(envio.cliente_id, clienteId)
        assert.equal(envio.asunto, 'Servicio reactivado')
        assert.include(envio.cuerpo, 'Tu servicio Plan Hogar 20 está activo de nuevo.')
        assert.notInclude(envio.cuerpo, 'suspendido')
    })

    test('ignora eventos que no se notifican o sin cliente', async ({ assert }) => {
        const consumidor = new ConsumidorNotify(new ColaFalsa())
        assert.isFalse(consumidor.acepta('servicio.creado'))
        assert.isFalse(consumidor.acepta('caja.cerrada'))
        assert.isTrue(consumidor.acepta('promesa.incumplida'))
        assert.isTrue(consumidor.acepta('comprobante.aprobado'))

        const outboxId = await eventoOutbox('servicio.creado', { servicio_id: 1 })
        await consumidor.procesar({ id: outboxId, evento: 'servicio.creado', payload: { servicio_id: 1 } })
        const otroId = await eventoOutbox('pago.registrado', { pago_id: 987_654_321 })
        await consumidor.procesar({
            id: otroId,
            evento: 'pago.registrado',
            payload: { pago_id: 987_654_321 },
        })

        const envios = await db
            .from('notify.envios')
            .whereIn('origen', [`outbox:${outboxId}`, `outbox:${otroId}`])
        assert.lengthOf(envios, 0)
    })
})
