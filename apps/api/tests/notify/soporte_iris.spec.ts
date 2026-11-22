import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { ConsumidorNotify } from '#notify/consumidor'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { CanalFalso, ColaFalsa, crearCliente, eventoOutbox } from '#tests/notify/ayudas_notify'

/**
 * Avisos de soporte de Iris (contrato 0.9.0 §6.6, A30 y A31): `soporte.ticket_estado_cambiado`,
 * `soporte.ticket_respondido` y `soporte.solicitud_estado_cambiado` (los reemite A1 desde los
 * webhooks de Iris) avisan al cliente por sus canales, sin el texto de los mensajes.
 */

async function consumir(evento: string, payload: Record<string, unknown>, id?: number) {
    const outboxId = id ?? (await eventoOutbox(evento, payload))
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id: outboxId, evento, payload })
    return { outboxId, envios: await enviosDe(Number(payload.cliente_id)) }
}

function enviosDe(clienteId: number) {
    return db
        .from('notify.envios')
        .where('cliente_id', clienteId)
        .where('evento', 'like', 'soporte.%')
        .orderBy('id')
}

function ticket(clienteId: number, extra: Record<string, unknown> = {}) {
    return {
        ticket_id: 'tk-77',
        numero: 'TK-000077',
        empresa_id: 1,
        cliente_id: clienteId,
        servicio_id: null,
        // canal por el que se abrió: no es la marca `origen: iris` de §7 (que no avisa)
        origen: 'iris',
        de: 'en_proceso',
        a: 'resuelto',
        puede_confirmar: true,
        webhook_id: 'iris-evt-1',
        ...extra,
    }
}

function respuesta(clienteId: number, extra: Record<string, unknown> = {}) {
    return {
        ticket_id: 'tk-88',
        numero: 'TK-000088',
        empresa_id: 1,
        cliente_id: clienteId,
        mensaje_id: 'm-1',
        autor_tipo: 'agente',
        masivo: false,
        aviso_por_correo: false,
        webhook_id: 'iris-evt-2',
        ...extra,
    }
}

test.group('notify · avisos de soporte de Iris (0.9.0)', (group) => {
    let telegram: CanalFalso
    group.each.setup(() => {
        telegram = new CanalFalso('telegram')
        registrarCanal('correo', new CanalFalso('correo'))
        registrarCanal('telegram', telegram)
        return () => reiniciarCanales()
    })

    test('ticket resuelto: «revisa y confirma» por correo y Telegram, una sola vez', async ({ assert }) => {
        const clienteId = await crearCliente({ telegram_chat_id: '900111', email: 'tk@prueba.local' })
        const payload = ticket(clienteId)
        const { outboxId, envios } = await consumir('soporte.ticket_estado_cambiado', payload)
        // el bus lo entrega dos veces: no se duplica
        await consumir('soporte.ticket_estado_cambiado', payload, outboxId)
        const todos = await enviosDe(clienteId)
        assert.lengthOf(envios, 2)
        assert.lengthOf(todos, 2)
        assert.sameMembers(
            todos.map((e) => e.canal),
            ['correo', 'telegram'],
        )
        const correo = todos.find((e) => e.canal === 'correo')!
        assert.equal(correo.evento, 'soporte.ticket_resuelto')
        assert.equal(correo.asunto, 'Tu ticket TK-000077 quedó resuelto')
        assert.include(correo.cuerpo, 'Revísalo y confírmalo')
        assert.equal(correo.estado, 'encolado')
    })

    test('ticket cerrado avisa el cierre; otros estados no avisan', async ({ assert }) => {
        const clienteId = await crearCliente()
        await consumir(
            'soporte.ticket_estado_cambiado',
            ticket(clienteId, { a: 'en_proceso', de: 'abierto' }),
        )
        assert.lengthOf(await enviosDe(clienteId), 0)
        const { envios } = await consumir(
            'soporte.ticket_estado_cambiado',
            ticket(clienteId, { a: 'cerrado' }),
        )
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].evento, 'soporte.ticket_cerrado')
        assert.include(envios[0].cuerpo, 'Tu ticket TK-000077 quedó cerrado')
    })

    test('respuesta con aviso_por_correo: sin correo; solo Telegram y sin respaldo por correo', async ({
        assert,
    }) => {
        const soloCorreo = await crearCliente({ email: 'solo@prueba.local' })
        const sinNada = await consumir(
            'soporte.ticket_respondido',
            respuesta(soloCorreo, { aviso_por_correo: true }),
        )
        // Iris ya mandó el correo: nada que enviar, y tampoco un «fallido sin destino»
        assert.lengthOf(sinNada.envios, 0)

        const conTelegram = await crearCliente({ telegram_chat_id: '900222', email: 'tg@prueba.local' })
        const { envios } = await consumir(
            'soporte.ticket_respondido',
            respuesta(conTelegram, { aviso_por_correo: true }),
        )
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].canal, 'telegram')
        assert.include(envios[0].cuerpo, 'Tienes una respuesta en tu ticket TK-000088')

        // Telegram falla para siempre: no cae al correo (Iris ya lo mandó)
        telegram.fallar = () => ({ permanente: true })
        const r = await new EnviarNotificacion().execute(
            { envioId: envios[0].id, intento: 1, maxIntentos: 5 },
            contextoSistema('worker'),
        )
        assert.equal(r.estado, 'fallido')
        assert.isUndefined(r.fallbackId)
        assert.lengthOf(await enviosDe(conTelegram), 1)
    })

    test('respuesta sin aviso_por_correo: correo con el número, nunca el texto', async ({ assert }) => {
        const clienteId = await crearCliente()
        const { envios } = await consumir('soporte.ticket_respondido', respuesta(clienteId))
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].canal, 'correo')
        assert.equal(envios[0].asunto, 'Tienes una respuesta en tu ticket TK-000088')
        assert.notProperty(envios[0].variables.ticket, 'texto')
    })

    test('respuesta masiva: un solo aviso por cliente en la ventana', async ({ assert }) => {
        const clienteId = await crearCliente()
        const otro = await crearCliente()
        const primera = await consumir(
            'soporte.ticket_respondido',
            respuesta(clienteId, { masivo: true, autor_tipo: 'sistema', ticket_id: 'tk-1', numero: 'TK-1' }),
        )
        assert.lengthOf(primera.envios, 1)
        assert.equal(primera.envios[0].asunto, 'Novedades sobre una falla en el servicio')
        // la misma entrega repetida no crea otro
        await consumir(
            'soporte.ticket_respondido',
            respuesta(clienteId, { masivo: true, ticket_id: 'tk-1', numero: 'TK-1' }),
            primera.outboxId,
        )
        // otro ticket del mismo cliente en la misma falla: no avisa de nuevo
        await consumir(
            'soporte.ticket_respondido',
            respuesta(clienteId, { masivo: true, ticket_id: 'tk-2', numero: 'TK-2' }),
        )
        assert.lengthOf(await enviosDe(clienteId), 1)
        // otro cliente sí recibe el suyo
        const delOtro = await consumir('soporte.ticket_respondido', respuesta(otro, { masivo: true }))
        assert.lengthOf(delOtro.envios, 1)

        // pasada la ventana, una novedad nueva vuelve a avisar
        await db
            .from('notify.envios')
            .where('cliente_id', clienteId)
            .update({ created_at: new Date(Date.now() - 2 * 3600_000) })
        await consumir('soporte.ticket_respondido', respuesta(clienteId, { masivo: true, ticket_id: 'tk-3' }))
        assert.lengthOf(await enviosDe(clienteId), 2)
    })

    test('solicitud de servicio: el estado nuevo en palabras', async ({ assert }) => {
        const clienteId = await crearCliente()
        const { envios } = await consumir('soporte.solicitud_estado_cambiado', {
            solicitud_id: '731',
            numero: 'PR-000731',
            empresa_id: 1,
            cliente_id: clienteId,
            tipo: 'traslado',
            servicio_id: null,
            de: 'recibida',
            a: 'en_revision',
            webhook_id: 'iris-evt-3',
        })
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].evento, 'soporte.solicitud_estado_cambiado')
        assert.equal(envios[0].asunto, 'Tu solicitud PR-000731: la estamos revisando')
        assert.include(envios[0].cuerpo, 'Tu solicitud de traslado PR-000731 la estamos revisando.')
    })
})
