import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { Worker } from 'bullmq'
import { ColaEnviosBullmq, crearWorkerEnvios } from '#notify/cola'
import { ConsumidorNotify } from '#notify/consumidor'
import { CanalCorreo } from '#notify/canales/correo'
import { CanalTelegram } from '#notify/canales/telegram'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import {
    CanalFalso,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
    fetchTelegramFalso,
    respuestaTelegramOk,
} from '#tests/notify/ayudas_notify'

/**
 * Integración con BullMQ real (Redis de `REDIS_HOST`, prefijo propio por corrida) y, si hay
 * `MAILPIT_API` + `SMTP_HOST`/`SMTP_PORT`, con Mailpit (criterio: factura emitida → correo < 10 s).
 */

async function esperarHasta<T>(fn: () => Promise<T | null | undefined | false>, ms = 10_000): Promise<T> {
    const limite = Date.now() + ms
    for (;;) {
        const valor = await fn()
        if (valor) return valor
        if (Date.now() > limite) throw new Error(`No se cumplió la condición en ${ms} ms`)
        await new Promise((resolver) => setTimeout(resolver, 50))
    }
}

/** Simula al relay de A1: lee la fila de `audit.outbox` y la entrega al consumidor. */
async function relayar(consumidor: ConsumidorNotify, outboxId: number) {
    const fila = await db.from('audit.outbox').where('id', outboxId).firstOrFail()
    await consumidor.procesar({
        id: fila.id,
        evento: fila.evento,
        payload: fila.payload,
        requestId: fila.request_id,
    })
}

test.group('notify · cola BullMQ', (group) => {
    let cola: ColaEnviosBullmq
    let worker: Worker
    let correo: CanalFalso

    group.each.setup(async () => {
        const prefijo = `a6test-${randomUUID().slice(0, 8)}`
        cola = new ColaEnviosBullmq({ prefijo, intentos: 3, esperaMs: 20 })
        worker = crearWorkerEnvios(cola, { prefijo })
        correo = new CanalFalso('correo')
        registrarCanal('correo', correo)
        return async () => {
            await worker.close()
            await cola.cola.obliterate({ force: true })
            await cola.cerrar()
            reiniciarCanales()
        }
    })

    test('reintenta con backoff y entrega al tercer intento', async ({ assert }) => {
        correo.fallar = (llamada) => (llamada < 3 ? { permanente: false } : null)
        const clienteId = await crearCliente({ email: 'reintentos@prueba.local' })
        const payload = { pago_id: 1, cliente_id: clienteId, monto: '10.00', metodo: 'caja', facturas: [] }
        const outboxId = await eventoOutbox('pago.registrado', payload)

        await relayar(new ConsumidorNotify(cola), outboxId)

        const envio = await esperarHasta(() =>
            db.from('notify.envios').where('origen', `outbox:${outboxId}`).where('estado', 'enviado').first(),
        )
        assert.equal(envio.intentos, 3)
        assert.equal(correo.llamadas, 3)
        assert.lengthOf(correo.enviados, 1)
    })

    test('encolar dos veces el mismo envío no lo entrega dos veces', async ({ assert }) => {
        const clienteId = await crearCliente()
        const payload = { pago_id: 1, cliente_id: clienteId, monto: '10.00', metodo: 'caja', facturas: [] }
        const outboxId = await eventoOutbox('pago.registrado', payload)
        const consumidor = new ConsumidorNotify(cola)

        await Promise.all([relayar(consumidor, outboxId), relayar(consumidor, outboxId)])
        await esperarHasta(() =>
            db.from('notify.envios').where('origen', `outbox:${outboxId}`).where('estado', 'enviado').first(),
        )
        await relayar(consumidor, outboxId)
        await new Promise((resolver) => setTimeout(resolver, 300))

        assert.lengthOf(await db.from('notify.envios').where('origen', `outbox:${outboxId}`), 1)
        assert.equal(correo.llamadas, 1)
    })
})

const mailpit = process.env.MAILPIT_API
const smtpHost = process.env.SMTP_HOST
const smtpPort = Number(process.env.SMTP_PORT ?? 1025)

test.group('notify · Mailpit (criterio de aceptación)', (group) => {
    let cola: ColaEnviosBullmq
    let worker: Worker

    group.each.setup(async () => {
        const prefijo = `a6test-${randomUUID().slice(0, 8)}`
        cola = new ColaEnviosBullmq({ prefijo, intentos: 3, esperaMs: 100 })
        worker = crearWorkerEnvios(cola, { prefijo })
        return async () => {
            await worker.close()
            await cola.cola.obliterate({ force: true })
            await cola.cerrar()
            reiniciarCanales()
        }
    })

    test('factura emitida → correo en Mailpit en menos de 10 s; el cliente con Telegram recibe el mismo aviso', async ({
        assert,
    }) => {
        const correo = new CanalCorreo({
            host: smtpHost!,
            port: smtpPort,
            remitente: 'ArgosIsp <no-responder@argosisp.local>',
        })
        const telegramSimulado = fetchTelegramFalso((_metodo, cuerpo) => respuestaTelegramOk(cuerpo))
        registrarCanal('correo', correo)
        registrarCanal(
            'telegram',
            new CanalTelegram({
                token: '1:prueba',
                apiRoot: 'http://telegram.prueba',
                fetch: telegramSimulado.fetch,
            }),
        )
        const consumidor = new ConsumidorNotify(cola)

        const email = `${randomUUID().slice(0, 8)}@prueba.local`
        const porCorreo = await crearCliente({ nombre: 'Cliente Correo', email })
        const porTelegram = await crearCliente({
            nombre: 'Cliente Telegram',
            canal_preferido: 'telegram',
            telegram_chat_id: '31337',
        })

        const inicio = Date.now()
        for (const clienteId of [porCorreo, porTelegram]) {
            const servicioId = await crearServicio(clienteId)
            const facturaId = await crearFactura(clienteId, servicioId, {
                total: '199.00',
                vence: '2026-11-05',
            })
            const outboxId = await eventoOutbox('factura.emitida', {
                factura_id: facturaId,
                servicio_id: servicioId,
                cliente_id: clienteId,
                total: '199.00',
                vence: '2026-11-05',
            })
            await relayar(consumidor, outboxId)
        }

        const encontrado = await esperarHasta(async () => {
            const respuesta = await fetch(
                `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
            )
            const json = (await respuesta.json()) as { messages: Array<{ ID: string; Subject: string }> }
            return json.messages[0]
        }, 10_000)
        assert.isBelow(Date.now() - inicio, 10_000)
        assert.match(encontrado.Subject, /^Factura \d+ por Q 199\.00$/)

        const respuesta = await fetch(`${mailpit}/api/v1/message/${encontrado.ID}`)
        const mensaje = (await respuesta.json()) as { Text: string }
        assert.include(mensaje.Text, 'Hola Cliente Correo:')
        assert.include(mensaje.Text, 'Vence el 05/11/2026.')

        await esperarHasta(async () => telegramSimulado.llamadas.length > 0, 10_000)
        assert.equal(telegramSimulado.llamadas[0]!.cuerpo.chat_id, '31337')
        assert.match(String(telegramSimulado.llamadas[0]!.cuerpo.text), /^Factura \d+ por Q 199\.00\n\n/)
        await correo.cerrar()
    })
        .skip(!mailpit || !smtpHost, 'Requiere MAILPIT_API y SMTP_HOST/SMTP_PORT (Mailpit)')
        .timeout(20_000)
})
