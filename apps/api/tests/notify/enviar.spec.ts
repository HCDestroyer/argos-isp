import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import { ErrorCanal } from '#notify/canales/canal'
import { CanalTelegram } from '#notify/canales/telegram'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import {
    CanalFalso,
    ColaFalsa,
    crearCliente,
    eventoOutbox,
    fetchTelegramFalso,
    respuestaTelegramOk,
} from '#tests/notify/ayudas_notify'

/** Programa un `pago.registrado` para un cliente nuevo y devuelve el envío creado. */
async function programar(datos: Parameters<typeof crearCliente>[0] = {}) {
    const clienteId = await crearCliente(datos)
    const payload = { pago_id: 1, cliente_id: clienteId, monto: '25.00', metodo: 'caja', facturas: [1] }
    const outboxId = await eventoOutbox('pago.registrado', payload)
    const cola = new ColaFalsa()
    await new ConsumidorNotify(cola).procesar({ id: outboxId, evento: 'pago.registrado', payload })
    const envio = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).firstOrFail()
    return { clienteId, envio, outboxId }
}

const enviar = (envioId: number, intento = 1, maxIntentos = 3) =>
    new EnviarNotificacion().execute({ envioId, intento, maxIntentos }, contextoSistema('worker'))

test.group('notify · envío', (group) => {
    let correo: CanalFalso
    let telegram: CanalFalso

    group.each.setup(() => {
        correo = new CanalFalso('correo')
        telegram = new CanalFalso('telegram')
        registrarCanal('correo', correo)
        registrarCanal('telegram', telegram)
        return () => reiniciarCanales()
    })

    test('entrega, marca enviado y emite notificacion.enviada; repetir el job no reenvía', async ({
        assert,
    }) => {
        const { clienteId, envio } = await programar({ email: 'pago@prueba.local' })

        assert.deepEqual(await enviar(envio.id), { estado: 'enviado' })
        assert.deepEqual(await enviar(envio.id), { estado: 'omitido' })

        assert.lengthOf(correo.enviados, 1)
        assert.deepEqual(correo.enviados[0], {
            destino: 'pago@prueba.local',
            asunto: 'Pago recibido: Q 25.00',
            cuerpo: envio.cuerpo,
        })
        const fila = await db.from('notify.envios').where('id', envio.id).firstOrFail()
        assert.containsSubset(fila, { estado: 'enviado', intentos: 1, proveedor_id: 'correo-1', error: null })
        assert.isNotNull(fila.enviado_en)

        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        assert.lengthOf(eventos, 1)
        assert.deepEqual(eventos[0].payload, {
            cliente_id: clienteId,
            canal: 'correo',
            evento_origen: 'pago.registrado',
            estado: 'enviado',
        })
    })

    test('error transitorio: reintenta hasta el último intento y entonces queda fallido', async ({
        assert,
    }) => {
        const { envio } = await programar()
        correo.fallar = () => ({ permanente: false })

        const primero = await enviar(envio.id, 1, 3)
        assert.equal(primero.estado, 'reintentar')
        let fila = await db.from('notify.envios').where('id', envio.id).firstOrFail()
        assert.containsSubset(fila, { estado: 'encolado', intentos: 1 })
        assert.include(fila.error, 'falla simulada 1')

        const ultimo = await enviar(envio.id, 3, 3)
        assert.equal(ultimo.estado, 'fallido')
        assert.isUndefined(ultimo.fallbackId)
        fila = await db.from('notify.envios').where('id', envio.id).firstOrFail()
        assert.containsSubset(fila, { estado: 'fallido', intentos: 3 })
    })

    test('telegram con error permanente: fallido al primer intento y fallback por correo', async ({
        assert,
    }) => {
        const { clienteId, envio } = await programar({
            canal_preferido: 'telegram',
            telegram_chat_id: '4242',
            email: 'respaldo@prueba.local',
        })
        assert.equal(envio.canal, 'telegram')
        telegram.fallar = () => ({ permanente: true })

        const resultado = await enviar(envio.id, 1, 5)
        assert.equal(resultado.estado, 'fallido')
        assert.isNumber(resultado.fallbackId)

        const respaldo = await db.from('notify.envios').where('id', resultado.fallbackId!).firstOrFail()
        assert.containsSubset(respaldo, {
            cliente_id: clienteId,
            origen: envio.origen,
            canal: 'correo',
            destino: 'respaldo@prueba.local',
            estado: 'encolado',
            fallback_de: envio.id,
            asunto: 'Pago recibido: Q 25.00',
        })

        assert.deepEqual(await enviar(respaldo.id), { estado: 'enviado' })
        assert.lengthOf(correo.enviados, 1)

        const estados = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
            .orderBy('id')
        assert.deepEqual(
            estados.map((e) => [e.payload.canal, e.payload.estado]),
            [
                ['telegram', 'fallido'],
                ['correo', 'enviado'],
            ],
        )
    })

    test('canal no configurado en el entorno: fallido sin reintentos', async ({ assert }) => {
        const { envio } = await programar()
        registrarCanal('correo', null)

        const resultado = await enviar(envio.id, 1, 5)
        assert.equal(resultado.estado, 'fallido')
        assert.include(resultado.error, 'canal no configurado')
    })
})

test.group('notify · adaptador de Telegram (fetch simulado)', () => {
    test('envía sendMessage con chat_id y texto plano', async ({ assert }) => {
        const simulado = fetchTelegramFalso((_metodo, cuerpo) => respuestaTelegramOk(cuerpo))
        const canal = new CanalTelegram({
            token: '123:abc',
            apiRoot: 'http://telegram.prueba',
            fetch: simulado.fetch,
        })

        const resultado = await canal.enviar('987', 'Asunto', 'Cuerpo <b>sin</b> HTML')

        assert.equal(resultado.id, '987:42')
        assert.lengthOf(simulado.llamadas, 1)
        assert.equal(simulado.llamadas[0]!.url, 'http://telegram.prueba/bot123:abc/sendMessage')
        assert.containsSubset(simulado.llamadas[0]!.cuerpo, {
            chat_id: '987',
            text: 'Asunto\n\nCuerpo <b>sin</b> HTML',
        })
        assert.notProperty(simulado.llamadas[0]!.cuerpo, 'parse_mode')
        assert.equal(await canal.estado(resultado.id), 'enviado')
    })

    test('403 (bot bloqueado) es permanente; 500 y 429 se reintentan', async ({ assert }) => {
        for (const [status, permanente] of [
            [403, true],
            [400, true],
            [500, false],
            [429, false],
        ] as const) {
            const simulado = fetchTelegramFalso(() => ({
                status,
                json: { ok: false, error_code: status, description: `error ${status}` },
            }))
            const canal = new CanalTelegram({
                token: '1:x',
                apiRoot: 'http://telegram.prueba',
                fetch: simulado.fetch,
            })
            const error = await canal.enviar('1', null, 'hola').catch((e: unknown) => e)
            assert.instanceOf(error, ErrorCanal)
            assert.equal((error as ErrorCanal).permanente, permanente, `status ${status}`)
        }
    })
})
