import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { CanalTelegram } from '#notify/canales/telegram'
import GenerarCodigoTelegram from '#notify/actions/generar_codigo_telegram'
import DesvincularTelegramCliente from '#core/actions/desvincular_telegram_cliente'
import AnularCodigosTelegram from '#notify/actions/anular_codigos_telegram'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import { hashCodigoVinculacion, normalizarCodigo } from '#notify/telegram/config'
import { registrarWebhook } from '#notify/telegram/webhook'
import { contextoSistema } from '#shared/contexto'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import {
    crearCliente,
    crearServicio,
    fetchTelegramFalso,
    respuestaTelegramOk,
} from '#tests/notify/ayudas_notify'

/**
 * Bot de Telegram (semana 2, tarea 1): código de vinculación, webhook con secreto, `/start`,
 * `/estado`, `/desvincular`, `/ayuda` y `setWebhook`. La Bot API es un `fetch` simulado.
 */

const SECRETO = 'secreto-de-pruebas-del-webhook-0123456789'
const VARIABLES = {
    TELEGRAM_BOT_TOKEN: '123456:token-de-pruebas',
    TELEGRAM_BOT_NOMBRE: 'ArgosPruebaBot',
    TELEGRAM_WEBHOOK_SECRET: SECRETO,
    TELEGRAM_WEBHOOK_URL: 'https://isp.example/api/v1/telegram/webhook',
    NOTIFY_PORTAL_URL: 'https://portal.isp.example',
}

function fijarEntorno(valores: Record<string, string | undefined>) {
    const antes: Record<string, string | undefined> = {}
    for (const [clave, valor] of Object.entries(valores)) {
        antes[clave] = process.env[clave]
        if (valor === undefined) delete process.env[clave]
        else process.env[clave] = valor
    }
    return () => fijarEntorno(antes)
}

function chatUnico(): number {
    return 7_000_000_000 + randomInt(0, 900_000_000)
}

let updateId = randomInt(1, 1_000_000_000)

function actualizacion(chatId: number, texto: string, tipo = 'private') {
    return {
        update_id: ++updateId,
        message: {
            message_id: randomInt(1, 1_000_000),
            date: 1_760_000_000,
            from: { id: chatId, is_bot: false, first_name: 'Prueba' },
            chat: { id: chatId, type: tipo },
            text: texto,
        },
    }
}

function webhook(client: ApiClient, cuerpo: unknown, secreto: string | null = SECRETO) {
    const peticion = client.post('/api/v1/telegram/webhook').json(cuerpo as Record<string, unknown>)
    return secreto === null ? peticion : peticion.header('X-Telegram-Bot-Api-Secret-Token', secreto)
}

/** Bot API simulada: registra los `sendMessage` y devuelve ok. */
function botApiFalsa() {
    const api = fetchTelegramFalso((_metodo, cuerpo) => respuestaTelegramOk(cuerpo))
    registrarCanal('telegram', new CanalTelegram({ token: VARIABLES.TELEGRAM_BOT_TOKEN, fetch: api.fetch }))
    return {
        mensajes: () =>
            api.llamadas
                .filter((l) => l.metodo === 'sendMessage')
                .map((l) => ({ chat_id: String(l.cuerpo.chat_id), text: String(l.cuerpo.text) })),
    }
}

async function codigoPara(clienteId: number) {
    return new GenerarCodigoTelegram().execute({ cliente_id: clienteId }, contextoSistema('portal'))
}

async function chatDe(clienteId: number) {
    const fila = await db
        .from('core.clientes')
        .where('id', clienteId)
        .select('telegram_chat_id')
        .firstOrFail()
    return fila.telegram_chat_id as string | null
}

test.group('notify · Telegram · código de vinculación', (group) => {
    let restaurar: () => void
    group.each.setup(() => {
        restaurar = fijarEntorno(VARIABLES)
        return () => restaurar()
    })

    test('genera un código de un solo uso con enlace t.me; guarda solo el hash; otro código reemplaza', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const ctx = contextoPrueba()
        const primero = await new GenerarCodigoTelegram().execute({ cliente_id: clienteId }, ctx)

        assert.match(primero.codigo, /^[A-Z2-9]{10}$/)
        assert.equal(primero.bot, 'ArgosPruebaBot')
        assert.equal(primero.enlace, `https://t.me/ArgosPruebaBot?start=${primero.codigo}`)
        const vence = new Date(primero.vence_en).getTime() - Date.now()
        assert.isAbove(vence, 880_000)
        assert.isBelow(vence, 901_000)

        const fila = await db
            .from('notify.telegram_codigos')
            .where('codigo_hash', hashCodigoVinculacion(primero.codigo))
            .firstOrFail()
        assert.equal(fila.cliente_id, clienteId)
        assert.equal(fila.estado, 'pendiente')
        const accion = await db.from('audit.acciones').where('request_id', ctx.requestId).firstOrFail()
        assert.equal(accion.accion, 'notificaciones.telegram_codigo')
        assert.notInclude(JSON.stringify(accion), primero.codigo)

        const segundo = await codigoPara(clienteId)
        assert.notEqual(segundo.codigo, primero.codigo)
        const estados = await db
            .from('notify.telegram_codigos')
            .where('cliente_id', clienteId)
            .orderBy('id')
            .select('estado')
        assert.deepEqual(
            estados.map((e) => e.estado),
            ['reemplazado', 'pendiente'],
        )
    })

    test('sin bot configurado responde 503 telegram_no_configurado', async ({ assert }) => {
        const deshacer = fijarEntorno({ TELEGRAM_BOT_NOMBRE: undefined })
        try {
            const clienteId = await crearCliente()
            const error = await codigoPara(clienteId).catch((e) => e)
            assert.equal(error.status, 503)
            assert.equal(error.code, 'E_TELEGRAM_NO_CONFIGURADO')
        } finally {
            deshacer()
        }
    })

    test('normaliza minúsculas, espacios y guiones; rechaza otra forma', ({ assert }) => {
        assert.equal(normalizarCodigo(' abcd-efgh 23 '), 'ABCDEFGH23')
        assert.isNull(normalizarCodigo('ABC'))
        assert.isNull(normalizarCodigo('ABCDEFGHI0')) // 0 no está en el alfabeto
    })
})

test.group('notify · Telegram · webhook del bot', (group) => {
    let restaurar: () => void
    group.each.setup(() => {
        restaurar = fijarEntorno(VARIABLES)
        return () => {
            restaurar()
            reiniciarCanales()
        }
    })

    test('sin secreto, con secreto equivocado o sin secreto configurado responde 401', async ({ client }) => {
        botApiFalsa()
        const cuerpo = actualizacion(chatUnico(), '/ayuda')
        await estado(webhook(client, cuerpo, null), 401)
        await estado(webhook(client, cuerpo, 'otro-secreto-cualquiera-0000'), 401)
        const deshacer = fijarEntorno({ TELEGRAM_WEBHOOK_SECRET: undefined })
        try {
            await estado(webhook(client, cuerpo, SECRETO), 401)
        } finally {
            deshacer()
        }
    })

    test('/start <código> vincula el chat, saluda por el primer nombre y audita sin el código', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const clienteId = await crearCliente({ nombre: `María ${unico('García')}` })
        const { codigo } = await codigoPara(clienteId)
        const chat = chatUnico()

        const requestId = unico('req')
        const respuesta = await webhook(client, actualizacion(chat, `/start ${codigo}`)).header(
            'X-Request-Id',
            requestId,
        )
        respuesta.assertStatus(200)
        assert.deepEqual(respuesta.body(), { ok: true })
        assert.equal(await chatDe(clienteId), String(chat))

        const [mensaje] = bot.mensajes()
        assert.equal(mensaje?.chat_id, String(chat))
        assert.match(mensaje!.text, /^Listo, María\. Este chat quedó vinculado/)

        const acciones = await db
            .from('audit.acciones')
            .where('request_id', requestId)
            .orderBy('id')
            .select('accion', 'canal', 'entidad_id', 'entrada')
        assert.sameMembers(
            acciones.map((a) => a.accion),
            ['notificaciones.telegram_vincular', 'clientes.vincular_telegram'],
        )
        for (const accion of acciones) {
            assert.equal(accion.canal, 'webhook')
            assert.equal(accion.entidad_id, clienteId)
            assert.notInclude(JSON.stringify(accion.entrada), codigo)
        }
        const cambio = await db
            .from('audit.cambios')
            .where({ request_id: requestId, entidad_tipo: 'cliente', campo: 'telegram_chat_id' })
            .firstOrFail()
        assert.equal(cambio.despues, String(chat))
        const fila = await db
            .from('notify.telegram_codigos')
            .where('codigo_hash', hashCodigoVinculacion(codigo))
            .firstOrFail()
        assert.equal(fila.estado, 'usado')
        assert.equal(fila.chat_id, String(chat))
    })

    test('reintento del mismo chat responde lo mismo; otro chat, código vencido o reemplazado no vinculan', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const clienteId = await crearCliente({ nombre: 'Juan Pérez' })
        const { codigo } = await codigoPara(clienteId)
        const chat = chatUnico()
        const intruso = chatUnico()

        const update = actualizacion(chat, `/start ${codigo.toLowerCase()}`)
        await estado(webhook(client, update), 200)
        await estado(webhook(client, update), 200) // Telegram reintenta la misma actualización
        await estado(webhook(client, actualizacion(intruso, `/start ${codigo}`)), 200)
        assert.equal(await chatDe(clienteId), String(chat))

        const mensajes = bot.mensajes()
        assert.match(mensajes[0]!.text, /^Listo, Juan\./)
        assert.match(mensajes[1]!.text, /^Listo, Juan\./)
        assert.equal(mensajes[2]!.chat_id, String(intruso))
        assert.match(mensajes[2]!.text, /no es válido o ya venció/)
        assert.include(mensajes[2]!.text, 'https://portal.isp.example')
        assert.notInclude(mensajes[2]!.text, 'Juan')

        // vencido
        const otroCliente = await crearCliente()
        const vencido = await codigoPara(otroCliente)
        await db.rawQuery(
            "UPDATE notify.telegram_codigos SET vence_en = now() - interval '1 second' WHERE codigo_hash = ?",
            [hashCodigoVinculacion(vencido.codigo)],
        )
        await estado(webhook(client, actualizacion(intruso, `/start ${vencido.codigo}`)), 200)
        // reemplazado
        const viejo = await codigoPara(otroCliente)
        await codigoPara(otroCliente)
        await estado(webhook(client, actualizacion(intruso, `/start ${viejo.codigo}`)), 200)
        // basura
        await estado(webhook(client, actualizacion(intruso, '/start hola')), 200)
        assert.isNull(await chatDe(otroCliente))
        for (const m of bot.mensajes().slice(3)) assert.match(m.text, /no es válido o ya venció/)
        assert.lengthOf(bot.mensajes(), 6)
    })

    test('/estado: solo a chats vinculados; servicios, estado y saldo sin datos sensibles', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const chat = chatUnico()
        await estado(webhook(client, actualizacion(chat, '/estado')), 200)
        assert.match(bot.mensajes()[0]!.text, /^Este chat no está vinculado a ninguna cuenta\./)

        const clienteId = await crearCliente({ nombre: 'Ana López', telegram_chat_id: String(chat) })
        const servicioId = await crearServicio(clienteId, 'Residencial 20M')
        const servicio = await db.from('core.servicios').where('id', servicioId).firstOrFail()
        const usuarioPpp = servicio.user_ppp as string
        await new RegistrarSaldoInicial().execute(
            { clave_externa: unico('saldo'), cliente_id: clienteId, monto: '80.00' },
            contextoSistema('consola'),
        )
        await estado(webhook(client, actualizacion(chat, '/estado@ArgosPruebaBot')), 200)
        const texto = bot.mensajes()[1]!.text
        assert.include(texto, 'Cuenta de Ana:')
        assert.include(texto, `Servicio ${servicioId} (Residencial 20M): activo`)
        assert.include(texto, 'Saldo pendiente: Q 80.00')
        assert.notInclude(texto, usuarioPpp)
        assert.notInclude(texto, 'López')

        // otro cliente con saldo a favor en el mismo chat (una persona con dos cuentas)
        const otroId = await crearCliente({ nombre: 'Ana Ruiz', telegram_chat_id: String(chat) })
        await new RegistrarSaldoInicial().execute(
            { clave_externa: unico('saldo'), cliente_id: otroId, monto: '-20.00' },
            contextoSistema('consola'),
        )
        await estado(webhook(client, actualizacion(chat, '/estado')), 200)
        const dos = bot.mensajes()[2]!.text
        assert.include(dos, 'Saldo pendiente: Q 80.00')
        assert.include(dos, 'Sin servicios activos.\nSaldo a favor: Q 20.00\nEstás al día con tus pagos.')
    })

    test('en un grupo no vincula ni muestra cuentas; /ayuda y texto libre muestran la ayuda', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const grupo = -1_000_000_000_000 - randomInt(0, 1_000_000)
        const clienteId = await crearCliente({ telegram_chat_id: String(grupo) })
        const { codigo } = await codigoPara(clienteId)

        await estado(webhook(client, actualizacion(grupo, `/start ${codigo}`, 'supergroup')), 200)
        await estado(webhook(client, actualizacion(grupo, '/estado', 'group')), 200)
        await estado(webhook(client, actualizacion(grupo, 'hola a todos', 'group')), 200)
        const enGrupo = bot.mensajes()
        assert.lengthOf(enGrupo, 2) // el texto libre del grupo no se contesta
        for (const m of enGrupo) assert.match(m.text, /^Por tu privacidad, solo atiendo en un chat privado/)
        const fila = await db
            .from('notify.telegram_codigos')
            .where('codigo_hash', hashCodigoVinculacion(codigo))
            .firstOrFail()
        assert.equal(fila.estado, 'pendiente')

        const chat = chatUnico()
        await estado(webhook(client, actualizacion(chat, '/ayuda')), 200)
        await estado(webhook(client, actualizacion(chat, '¿cuánto debo?')), 200)
        await estado(webhook(client, actualizacion(chat, '/start')), 200)
        const [ayuda, libre, inicio] = bot.mensajes().slice(2)
        assert.match(ayuda!.text, /^Esto es lo que puedo hacer:/)
        assert.include(ayuda!.text, '/estado')
        assert.equal(libre!.text, ayuda!.text)
        assert.match(inicio!.text, /^Hola\. Soy el asistente/)

        // actualizaciones sin mensaje de texto (edición, sticker) se aceptan y se ignoran
        await estado(webhook(client, { update_id: ++updateId, edited_message: { text: 'x' } }), 200)
        assert.lengthOf(bot.mensajes(), 5)
    })

    test('/desvincular quita el chat de la cuenta (con auditoría) y luego /estado ya no muestra nada', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const chat = chatUnico()
        const clienteId = await crearCliente({ telegram_chat_id: String(chat) })
        const requestId = unico('req')
        await estado(
            webhook(client, actualizacion(chat, '/desvincular')).header('X-Request-Id', requestId),
            200,
        )
        assert.isNull(await chatDe(clienteId))
        // Desvincular anula también los códigos pendientes (otra acción con el mismo request_id)
        const acciones = await db.from('audit.acciones').where('request_id', requestId).select('accion')
        assert.include(
            acciones.map((a) => a.accion),
            'clientes.desvincular_telegram',
        )
        await estado(webhook(client, actualizacion(chat, '/estado')), 200)
        assert.match(bot.mensajes()[0]!.text, /^Listo\. Este chat ya no recibirá avisos/)
        assert.match(bot.mensajes()[1]!.text, /^Este chat no está vinculado/)
    })

    test('desvincular (portal, panel o bot) anula los códigos pendientes: un enlace viejo no vuelve a vincular', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const chatViejo = chatUnico()
        const clienteId = await crearCliente({ telegram_chat_id: String(chatViejo) })
        const { codigo } = await codigoPara(clienteId)
        // el cliente se desvincula desde el portal (acción de A1) con el código aún vigente
        await new DesvincularTelegramCliente().execute({ id: clienteId }, contextoSistema('portal'))

        const intruso = chatUnico()
        await estado(webhook(client, actualizacion(intruso, `/start ${codigo}`)), 200)
        assert.isNull(await chatDe(clienteId))
        assert.match(bot.mensajes()[0]!.text, /no es válido o ya venció/)

        // un código pedido DESPUÉS de desvincular sí sirve
        const nuevo = await codigoPara(clienteId)
        const chat = chatUnico()
        await estado(webhook(client, actualizacion(chat, `/start ${nuevo.codigo}`)), 200)
        assert.equal(await chatDe(clienteId), String(chat))
    })

    test('/desvincular en el bot deja los códigos pendientes en anulado (AnularCodigosTelegram)', async ({
        client,
        assert,
    }) => {
        botApiFalsa()
        const chat = chatUnico()
        const clienteId = await crearCliente({ telegram_chat_id: String(chat) })
        const { codigo } = await codigoPara(clienteId)
        const requestId = unico('req')
        await estado(
            webhook(client, actualizacion(chat, '/desvincular')).header('X-Request-Id', requestId),
            200,
        )
        const fila = await db
            .from('notify.telegram_codigos')
            .where('codigo_hash', hashCodigoVinculacion(normalizarCodigo(codigo)!))
            .firstOrFail()
        assert.equal(fila.estado, 'anulado')
        const acciones = await db.from('audit.acciones').where('request_id', requestId).orderBy('id')
        assert.deepEqual(
            acciones.map((a) => a.accion),
            ['clientes.desvincular_telegram', 'notificaciones.telegram_anular_codigos'],
        )
        // Idempotente: sin pendientes no cambia nada
        const r = await new AnularCodigosTelegram().execute(
            { cliente_id: clienteId },
            contextoSistema('portal'),
        )
        assert.equal(r.anulados, 0)
    })

    test('código ya usado: tras /desvincular, reenviar el mismo /start no vuelve a vincular', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const clienteId = await crearCliente({ nombre: 'Rosa Díaz' })
        const { codigo } = await codigoPara(clienteId)
        const chat = chatUnico()
        const inicio = actualizacion(chat, `/start ${codigo}`)
        await estado(webhook(client, inicio), 200)
        assert.equal(await chatDe(clienteId), String(chat))
        await estado(webhook(client, actualizacion(chat, '/desvincular')), 200)
        assert.isNull(await chatDe(clienteId))

        await estado(webhook(client, inicio), 200) // el mismo enlace, otra vez
        assert.isNull(await chatDe(clienteId))
        const textos = bot.mensajes().map((m) => m.text)
        assert.match(textos[0]!, /^Listo, Rosa\./)
        assert.match(textos[2]!, /no es válido o ya venció/)
    })

    test('generar un código nuevo anula el anterior (pendiente → reemplazado)', async ({
        client,
        assert,
    }) => {
        const bot = botApiFalsa()
        const clienteId = await crearCliente()
        const viejo = await codigoPara(clienteId)
        const nuevo = await codigoPara(clienteId)
        const estados = await db
            .from('notify.telegram_codigos')
            .whereIn('codigo_hash', [
                hashCodigoVinculacion(viejo.codigo),
                hashCodigoVinculacion(nuevo.codigo),
            ])
            .orderBy('id')
            .select('estado')
        assert.deepEqual(
            estados.map((e) => e.estado),
            ['reemplazado', 'pendiente'],
        )
        await estado(webhook(client, actualizacion(chatUnico(), `/start ${viejo.codigo}`)), 200)
        assert.isNull(await chatDe(clienteId))
        assert.match(bot.mensajes()[0]!.text, /no es válido o ya venció/)
    })

    test('si la Bot API falla al responder, el webhook igual confirma (200) y la vinculación queda', async ({
        client,
        assert,
    }) => {
        const api = fetchTelegramFalso(() => ({
            status: 500,
            json: { ok: false, error_code: 500, description: 'Internal Server Error' },
        }))
        registrarCanal(
            'telegram',
            new CanalTelegram({ token: VARIABLES.TELEGRAM_BOT_TOKEN, fetch: api.fetch }),
        )
        const clienteId = await crearCliente()
        const { codigo } = await codigoPara(clienteId)
        const chat = chatUnico()
        await estado(webhook(client, actualizacion(chat, `/start ${codigo}`)), 200)
        assert.equal(await chatDe(clienteId), String(chat))
        assert.isAtLeast(api.llamadas.length, 1)
    })
})

test.group('notify · Telegram · registro del webhook', (group) => {
    let restaurar: () => void
    group.each.setup(() => {
        restaurar = fijarEntorno(VARIABLES)
        return () => restaurar()
    })

    test('setWebhook con el secreto y solo `message`; comandos en español', async ({ assert }) => {
        const api = fetchTelegramFalso(() => ({ status: 200, json: { ok: true, result: true } }))
        const resultado = await registrarWebhook({ fetch: api.fetch })
        // una URL por bot: <base>/<id del bot>
        assert.equal(resultado.url, `${VARIABLES.TELEGRAM_WEBHOOK_URL}/123456`)

        const set = api.llamadas.find((l) => l.metodo === 'setWebhook')!
        assert.include(set.url, `/bot${VARIABLES.TELEGRAM_BOT_TOKEN}/setWebhook`)
        assert.equal(set.cuerpo.url, `${VARIABLES.TELEGRAM_WEBHOOK_URL}/123456`)
        assert.equal(set.cuerpo.secret_token, SECRETO)
        assert.deepEqual(set.cuerpo.allowed_updates, ['message'])
        const comandos = api.llamadas.filter((l) => l.metodo === 'setMyCommands')
        assert.lengthOf(comandos, 2)
        assert.deepEqual(
            (comandos[0]!.cuerpo.commands as Array<{ command: string }>).map((c) => c.command),
            ['estado', 'ayuda', 'desvincular'],
        )
    })

    test('rechaza URL sin HTTPS, secreto corto y falta de token', async ({ assert }) => {
        const api = fetchTelegramFalso(() => ({ status: 200, json: { ok: true, result: true } }))
        await assert.rejects(
            () => registrarWebhook({ fetch: api.fetch, url: 'http://isp.example/x' }),
            /HTTPS/,
        )
        const deshacer = fijarEntorno({ TELEGRAM_WEBHOOK_SECRET: 'corto' })
        try {
            await assert.rejects(() => registrarWebhook({ fetch: api.fetch }), /TELEGRAM_WEBHOOK_SECRET/)
        } finally {
            deshacer()
        }
        const sinToken = fijarEntorno({ TELEGRAM_BOT_TOKEN: undefined })
        try {
            await assert.rejects(() => registrarWebhook({ fetch: api.fetch }), /TELEGRAM_BOT_TOKEN/)
        } finally {
            sinToken()
        }
        assert.lengthOf(api.llamadas, 0)
    })
})
