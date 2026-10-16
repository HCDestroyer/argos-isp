import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import EnviarMensajeDirecto, { type EntradaMensajeDirecto } from '#notify/actions/enviar_mensaje_directo'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { CanalFalso, crearCliente } from '#tests/notify/ayudas_notify'

const enviar = (entrada: EntradaMensajeDirecto) =>
    new EnviarMensajeDirecto().execute(entrada, contextoSistema('portal'))

test.group('notify · mensaje directo', (group) => {
    let correo: CanalFalso
    let telegram: CanalFalso

    group.each.setup(() => {
        correo = new CanalFalso('correo')
        telegram = new CanalFalso('telegram')
        registrarCanal('correo', correo)
        registrarCanal('telegram', telegram)
        return () => reiniciarCanales()
    })

    test('envía en el momento por un canal, sin guardar el secreto ni en envíos ni en auditoría', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ email: 'Ana@Prueba.local', telegram_chat_id: '5551' })
        const ctx = contextoSistema('portal')
        const r = await new EnviarMensajeDirecto().execute(
            {
                cliente_id: clienteId,
                canal: 'correo',
                destino: 'ana@prueba.local',
                motivo: 'portal.codigo_acceso',
                asunto: 'Tu código de acceso',
                cuerpo: 'Tu código es {{secreto}}. Vence en 10 minutos.',
                secreto: '483920',
            },
            ctx,
        )
        assert.equal(r.estado, 'enviado')
        assert.isNull(r.error)
        // Llegó con el código, solo por correo
        assert.deepEqual(correo.enviados, [
            {
                destino: 'ana@prueba.local',
                asunto: 'Tu código de acceso',
                cuerpo: 'Tu código es 483920. Vence en 10 minutos.',
            },
        ])
        assert.lengthOf(telegram.enviados, 0)

        const envio = await db.from('notify.envios').where('id', r.envio_id).firstOrFail()
        assert.containSubset(envio, {
            cliente_id: clienteId,
            evento: 'portal.codigo_acceso',
            canal: 'correo',
            estado: 'enviado',
            intentos: 1,
            cuerpo: 'Tu código es {{secreto}}. Vence en 10 minutos.',
            request_id: ctx.requestId,
        })
        assert.notInclude(JSON.stringify(envio), '483920')

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.enviar_directo')
            .where('request_id', ctx.requestId)
            .firstOrFail()
        assert.notInclude(JSON.stringify(auditoria.entrada), '483920')
        assert.equal(auditoria.entrada.secreto, '***')

        const evento = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .where('request_id', ctx.requestId)
            .firstOrFail()
        assert.deepEqual(evento.payload, {
            cliente_id: clienteId,
            canal: 'correo',
            evento_origen: 'portal.codigo_acceso',
            estado: 'enviado',
        })
    })

    test('por Telegram al chat registrado; si el canal falla devuelve fallido sin reintentar', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ telegram_chat_id: '7777' })
        telegram.fallar = () => ({ permanente: false })
        const r = await enviar({
            cliente_id: clienteId,
            canal: 'telegram',
            destino: '7777',
            motivo: 'portal.codigo_acceso',
            cuerpo: 'Código {{secreto}}',
            secreto: '111222',
        })
        assert.equal(r.estado, 'fallido')
        assert.match(r.error!, /falla simulada 1/)
        assert.equal(telegram.llamadas, 1)
        assert.lengthOf(correo.enviados, 0) // sin fallback a otro canal
        const envio = await db.from('notify.envios').where('id', r.envio_id).firstOrFail()
        assert.equal(envio.estado, 'fallido')
        assert.equal(envio.intentos, 1)
    })

    test('canal no configurado: fallido', async ({ assert }) => {
        registrarCanal('telegram', null)
        const clienteId = await crearCliente({ telegram_chat_id: '8888' })
        const r = await enviar({
            cliente_id: clienteId,
            canal: 'telegram',
            destino: '8888',
            motivo: 'portal.codigo_acceso',
            cuerpo: 'x',
        })
        assert.equal(r.estado, 'fallido')
        assert.match(r.error!, /no configurado/)
    })

    test('rechaza un destino que no es el registrado del cliente', async ({ assert }) => {
        const clienteId = await crearCliente({ email: 'dueno@prueba.local', telegram_chat_id: '42' })
        for (const [canal, destino] of [
            ['correo', 'otro@prueba.local'],
            ['telegram', '43'],
        ] as const) {
            await assert.rejects(
                () =>
                    enviar({
                        cliente_id: clienteId,
                        canal,
                        destino,
                        motivo: 'portal.codigo_acceso',
                        cuerpo: 'x',
                    }),
                ValidacionFallida,
            )
        }
        assert.lengthOf(correo.enviados, 0)
        assert.lengthOf(telegram.enviados, 0)
    })
})
