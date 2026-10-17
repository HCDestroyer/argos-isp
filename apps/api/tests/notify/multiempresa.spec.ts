import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { reiniciarCanales } from '#notify/canales/registro'
import { fijarTransporteTelegram, recargarConfiguracion } from '#notify/configuracion'
import { ConsumidorNotify } from '#notify/consumidor'
import ConfigurarNotificaciones, { type EntradaConfigurar } from '#notify/actions/configurar_notificaciones'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import GenerarCodigoTelegram from '#notify/actions/generar_codigo_telegram'
import { telegramPorEmpresa } from '#notify/telegram/vinculos'
import {
    ColaFalsa,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
    fetchTelegramFalso,
    respuestaTelegramOk,
} from '#tests/notify/ayudas_notify'
import { SmtpFalso } from '#tests/notify/smtp_falso'
import { contextoPrueba, estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'

/**
 * Notificaciones con dos empresas (`contratos/multiempresa.md`): `{{empresa.*}}` y el nombre
 * visible del remitente salen de la empresa del servicio; Telegram sale por el bot de la empresa
 * (el suyo o el global) y solo a clientes vinculados a ese bot.
 */

const TOKEN_GLOBAL = `7770001:${'A'.repeat(35)}`
const TOKEN_SUR = `8880002:${'B'.repeat(35)}`
const SECRETO_GLOBAL = 'secreto-webhook-global-0123456789'
const SECRETO_SUR = 'secreto-webhook-sur-0123456789ab'

async function limpiar() {
    await db.from('notify.configuracion_canales').delete()
    reiniciarCanales()
    fijarTransporteTelegram({})
    await recargarConfiguracion()
}

async function configurar(entrada: Partial<EntradaConfigurar> & { empresa_id?: number | null }) {
    const empresaId = entrada.empresa_id ?? null
    const actual = (await db
        .from('notify.configuracion_canales')
        .if(empresaId === null, (q) => q.whereNull('empresa_id'))
        .if(empresaId !== null, (q) => q.where('empresa_id', empresaId!))
        .select('version')
        .first()) as { version: number } | null
    return new ConfigurarNotificaciones().execute(
        { version: actual?.version ?? 0, ...entrada, empresa_id: empresaId },
        contextoPrueba(),
    )
}

interface Envio {
    id: number
    canal: string
    destino: string
    estado: string
    cuerpo: string
    asunto: string | null
    empresa_id: number | null
    variables: { empresa: Record<string, unknown> }
}

/** `factura.emitida` de un servicio de `empresaId` (sin `empresa_id` en el payload: se deduce). */
async function facturaEmitida(clienteId: number, servicioId: number): Promise<Envio[]> {
    const facturaId = await crearFactura(clienteId, servicioId)
    const payload = { factura_id: facturaId, servicio_id: servicioId, cliente_id: clienteId, total: '150.00' }
    const outboxId = await eventoOutbox('factura.emitida', payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id: outboxId, evento: 'factura.emitida', payload })
    return (await db
        .from('notify.envios')
        .where('origen', `outbox:${outboxId}`)
        .orderBy('canal')
        .select('id', 'canal', 'destino', 'estado', 'cuerpo', 'asunto', 'empresa_id', 'variables')) as Envio[]
}

test.group('notify · multiempresa · marca de la empresa', (group) => {
    let smtp: SmtpFalso
    const entorno = process.env.NOTIFY_API_URL
    group.each.setup(async () => {
        await limpiar()
        smtp = await new SmtpFalso().iniciar()
        process.env.NOTIFY_API_URL = 'https://api.isp.example/'
        await configurar({
            correo: {
                host: '127.0.0.1',
                puerto: smtp.puerto,
                tls: 'ninguno',
                remitente: 'avisos@grupo.example',
                nombre_visible: 'Grupo ISP',
            },
        })
        return async () => {
            if (entorno === undefined) delete process.env.NOTIFY_API_URL
            else process.env.NOTIFY_API_URL = entorno
            await smtp.cerrar()
            await limpiar()
            await soloEmpresaPrincipal()
        }
    })

    test('cada aviso lleva los datos y el nombre de remitente de la empresa de su servicio', async ({
        assert,
    }) => {
        const norte = await crearEmpresaFila({
            nombre_comercial: 'Cable Norte',
            razon_social: 'Cable Norte, S.A.',
            direccion_fiscal: '1a. calle 1-11, Huehuetenango',
            telefono: '7764-0000',
            whatsapp: '5555-1111',
            correo: 'ayuda@cablenorte.gt',
            logo: 'logos/empresas/norte/logo.png',
            logo_tipo: 'image/png',
            logo_etag: 'a'.repeat(64),
        })
        const sur = await crearEmpresaFila({
            nombre_comercial: 'Fibra Sur',
            razon_social: 'Fibra del Sur, S.A.',
            direccion_fiscal: 'Av. Las Américas 9-99, Escuintla',
            telefono: '7888-0000',
        })
        // Un cliente con un servicio en cada empresa
        const clienteId = await crearCliente({ nombre: 'Rosa Pérez' })
        const servicioNorte = await crearServicio(clienteId, undefined, norte)
        const servicioSur = await crearServicio(clienteId, undefined, sur)

        const [deNorte] = await facturaEmitida(clienteId, servicioNorte)
        const [deSur] = await facturaEmitida(clienteId, servicioSur)
        assert.equal(deNorte!.canal, 'correo')
        assert.equal(deNorte!.empresa_id, norte)
        assert.equal(deSur!.empresa_id, sur)

        const filaNorte = await db.from('core.empresas').where('id', norte).select('nit').firstOrFail()
        const nitNorte = filaNorte.nit
        assert.containsSubset(deNorte!.variables.empresa, {
            id: norte,
            nombre: 'Cable Norte',
            nombre_comercial: 'Cable Norte',
            razon_social: 'Cable Norte, S.A.',
            nit: nitNorte,
            direccion_fiscal: '1a. calle 1-11, Huehuetenango',
            logo_url: `https://api.isp.example/api/v1/empresas/${norte}/logo?v=${'a'.repeat(16)}`,
            soporte: {
                telefono: '7764-0000',
                whatsapp: '5555-1111',
                correo: 'ayuda@cablenorte.gt',
                horario: '',
                texto: 'Tel. 7764-0000 · WhatsApp 5555-1111 · ayuda@cablenorte.gt',
            },
        })
        assert.containsSubset(deSur!.variables.empresa, {
            id: sur,
            nombre_comercial: 'Fibra Sur',
            razon_social: 'Fibra del Sur, S.A.',
            logo_url: '',
            soporte: { texto: 'Tel. 7888-0000' },
        })
        // La plantilla base firma con la empresa del servicio
        assert.include(deNorte!.cuerpo, 'Cable Norte · 7764-0000')
        assert.notInclude(deNorte!.cuerpo, 'Fibra Sur')
        assert.include(deSur!.cuerpo, 'Fibra Sur · 7888-0000')

        // Remitente único (la configuración global) con el nombre comercial de la empresa
        for (const envio of [deNorte!, deSur!]) {
            const r = await new EnviarNotificacion().execute(
                { envioId: envio.id, intento: 1, maxIntentos: 3 },
                contextoPrueba(),
            )
            assert.equal(r.estado, 'enviado')
        }
        assert.lengthOf(smtp.mensajes, 2)
        assert.deepEqual(
            smtp.mensajes.map((m) => m.de),
            ['avisos@grupo.example', 'avisos@grupo.example'],
        )
        assert.match(smtp.mensajes[0]!.datos, /^From: "?Cable Norte"? <avisos@grupo\.example>/m)
        assert.match(smtp.mensajes[1]!.datos, /^From: "?Fibra Sur"? <avisos@grupo\.example>/m)
    })

    test('una empresa con su propio nombre visible lo conserva; sin empresa (o la 1 sin guardar) manda la configuración', async ({
        assert,
    }) => {
        const propia = await crearEmpresaFila({ nombre_comercial: 'Marca Comercial' })
        await configurar({
            empresa_id: propia,
            hereda: false,
            correo: {
                host: '127.0.0.1',
                puerto: smtp.puerto,
                tls: 'ninguno',
                remitente: 'hola@propia.example',
                nombre_visible: 'Soporte Propia',
            },
        })
        const clienteId = await crearCliente()
        const [envio] = await facturaEmitida(clienteId, await crearServicio(clienteId, undefined, propia))
        await new EnviarNotificacion().execute(
            { envioId: envio!.id, intento: 1, maxIntentos: 3 },
            contextoPrueba(),
        )
        assert.match(smtp.mensajes[0]!.datos, /^From: "?Soporte Propia"? <hola@propia\.example>/m)
    })
})

test.group('notify · multiempresa · Telegram por empresa', (group) => {
    let api: ReturnType<typeof fetchTelegramFalso>
    let norte: number
    let sur: number
    group.each.setup(async () => {
        await limpiar()
        api = fetchTelegramFalso((_metodo, cuerpo) => respuestaTelegramOk(cuerpo))
        fijarTransporteTelegram({ fetch: api.fetch, apiRoot: 'http://telegram.prueba' })
        norte = await crearEmpresaFila({ nombre_comercial: 'Cable Norte' })
        sur = await crearEmpresaFila({ nombre_comercial: 'Fibra Sur' })
        const correo = { host: 'smtp.isp.example', remitente: 'avisos@isp.example' }
        // Norte hereda el bot global; Sur tiene el suyo
        await configurar({
            correo,
            telegram: { token: TOKEN_GLOBAL, bot_nombre: 'GrupoBot', webhook_secreto: SECRETO_GLOBAL },
        })
        await configurar({
            empresa_id: sur,
            hereda: false,
            correo,
            telegram: { token: TOKEN_SUR, bot_nombre: 'FibraSurBot', webhook_secreto: SECRETO_SUR },
        })
        return async () => {
            await limpiar()
            await soloEmpresaPrincipal()
        }
    })

    function mensaje(chat: number, texto: string) {
        return {
            update_id: randomInt(1, 1_000_000_000),
            message: { message_id: 1, chat: { id: chat, type: 'private' }, text: texto },
        }
    }

    function webhook(client: ApiClient, bot: string, secreto: string, chat: number, texto: string) {
        return client
            .post(`/api/v1/telegram/webhook/${bot}`)
            .header('X-Telegram-Bot-Api-Secret-Token', secreto)
            .json(mensaje(chat, texto))
    }

    const ultimoTexto = () => String(api.llamadas.at(-1)!.cuerpo.text)
    const ultimoBot = () => api.llamadas.at(-1)!.url

    test('el cliente se vincula al bot de la empresa de su servicio, y a los dos si tiene servicios en las dos', async ({
        client,
        assert,
    }) => {
        const chat = 6_000_000_000 + randomInt(0, 900_000_000)
        const clienteId = await crearCliente({ nombre: 'Rosa Pérez', canal_preferido: 'telegram' })
        const servicioNorte = await crearServicio(clienteId, undefined, norte)
        const servicioSur = await crearServicio(clienteId, undefined, sur)

        // Código para Fibra Sur: el enlace es de su bot
        const codigoSur = await new GenerarCodigoTelegram().execute(
            { cliente_id: clienteId, empresa_id: sur },
            contextoPrueba(),
        )
        assert.equal(codigoSur.bot, 'FibraSurBot')
        assert.equal(codigoSur.empresa_id, sur)

        // Canjearlo en el bot global no vincula
        await estado(webhook(client, '7770001', SECRETO_GLOBAL, chat, `/start ${codigoSur.codigo}`), 200)
        assert.include(ultimoTexto(), 'no es válido')
        assert.include(ultimoBot(), `/bot${TOKEN_GLOBAL}/`)

        // En su bot sí
        await estado(webhook(client, '8880002', SECRETO_SUR, chat, `/start ${codigoSur.codigo}`), 200)
        assert.include(ultimoTexto(), 'Listo, Rosa')
        assert.include(ultimoBot(), `/bot${TOKEN_SUR}/`)
        assert.deepEqual(await telegramPorEmpresa(clienteId), [
            { empresa_id: norte, bot: 'GrupoBot', bot_id: '7770001', vinculado: false },
            { empresa_id: sur, bot: 'FibraSurBot', bot_id: '8880002', vinculado: true },
        ])

        // Aviso de Fibra Sur: por Telegram (bot de Sur), con la firma de la empresa
        let envios = await facturaEmitida(clienteId, servicioSur)
        const telegramSur = envios.find((e) => e.canal === 'telegram')!
        assert.equal(telegramSur.destino, String(chat))
        assert.equal(telegramSur.empresa_id, sur)
        assert.include(telegramSur.cuerpo, 'Fibra Sur')
        await new EnviarNotificacion().execute(
            { envioId: telegramSur.id, intento: 1, maxIntentos: 3 },
            contextoPrueba(),
        )
        assert.include(ultimoBot(), `/bot${TOKEN_SUR}/sendMessage`)

        // Aviso de Cable Norte: el bot global no lo tiene vinculado → solo correo
        envios = await facturaEmitida(clienteId, servicioNorte)
        assert.deepEqual(
            envios.map((e) => e.canal),
            ['correo'],
        )

        // /estado en el bot de Sur muestra solo el servicio de Sur
        await estado(webhook(client, '8880002', SECRETO_SUR, chat, '/estado'), 200)
        assert.include(ultimoTexto(), `Servicio ${servicioSur}`)
        assert.notInclude(ultimoTexto(), `Servicio ${servicioNorte}`)

        // Sin empresa_id, con servicios en dos empresas: el bot global
        const codigoGlobal = await new GenerarCodigoTelegram().execute(
            { cliente_id: clienteId },
            contextoPrueba(),
        )
        assert.equal(codigoGlobal.bot, 'GrupoBot')
        assert.isNull(codigoGlobal.empresa_id)
        await estado(webhook(client, '7770001', SECRETO_GLOBAL, chat, `/start ${codigoGlobal.codigo}`), 200)
        assert.include(ultimoTexto(), 'Listo, Rosa')
        envios = await facturaEmitida(clienteId, servicioNorte)
        const telegramNorte = envios.find((e) => e.canal === 'telegram')!
        assert.equal(telegramNorte.destino, String(chat))
        assert.include(telegramNorte.cuerpo, 'Cable Norte')
        await new EnviarNotificacion().execute(
            { envioId: telegramNorte.id, intento: 1, maxIntentos: 3 },
            contextoPrueba(),
        )
        assert.include(ultimoBot(), `/bot${TOKEN_GLOBAL}/sendMessage`)
        const vinculos = await db
            .from('notify.telegram_vinculos')
            .where('cliente_id', clienteId)
            .orderBy('bot_id')
            .select('bot_id', 'chat_id', 'empresa_id')
        assert.deepEqual(
            vinculos.map((v) => [v.bot_id, v.chat_id, v.empresa_id === null ? null : Number(v.empresa_id)]),
            [
                ['7770001', String(chat), null],
                ['8880002', String(chat), sur],
            ],
        )

        // /desvincular en el bot de Sur: sigue vinculado al global
        await estado(webhook(client, '8880002', SECRETO_SUR, chat, '/desvincular'), 200)
        const cliente = await db
            .from('core.clientes')
            .where('id', clienteId)
            .select('telegram_chat_id')
            .firstOrFail()
        assert.equal(cliente.telegram_chat_id, String(chat))
        envios = await facturaEmitida(clienteId, servicioSur)
        assert.deepEqual(
            envios.map((e) => e.canal),
            ['correo'],
        )
        envios = await facturaEmitida(clienteId, servicioNorte)
        assert.include(
            envios.map((e) => e.canal),
            'telegram',
        )

        // /desvincular en el global (el último bot): desvinculado del todo
        await estado(webhook(client, '7770001', SECRETO_GLOBAL, chat, '/desvincular'), 200)
        const despues = await db
            .from('core.clientes')
            .where('id', clienteId)
            .select('telegram_chat_id')
            .firstOrFail()
        assert.isNull(despues.telegram_chat_id)
        const restantes = await db.from('notify.telegram_vinculos').where('cliente_id', clienteId)
        assert.lengthOf(restantes, 0)
    })

    test('un cliente vinculado antes de los bots por empresa recibe por el bot global, no por el de otra empresa', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ canal_preferido: 'telegram', telegram_chat_id: '515151' })
        const envNorte = await facturaEmitida(clienteId, await crearServicio(clienteId, undefined, norte))
        assert.equal(envNorte.find((e) => e.canal === 'telegram')?.destino, '515151')
        const envSur = await facturaEmitida(clienteId, await crearServicio(clienteId, undefined, sur))
        assert.isUndefined(envSur.find((e) => e.canal === 'telegram'))
    })

    test('el código pedido sin empresa toma la única empresa de los servicios del cliente', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        await crearServicio(clienteId, undefined, sur)
        const codigo = await new GenerarCodigoTelegram().execute({ cliente_id: clienteId }, contextoPrueba())
        assert.equal(codigo.bot, 'FibraSurBot')
        assert.equal(codigo.empresa_id, sur)
        // empresa_id de una empresa en la que no tiene servicios: 422
        await assert.rejects(() =>
            new GenerarCodigoTelegram().execute(
                { cliente_id: clienteId, empresa_id: norte },
                contextoPrueba(),
            ),
        )
    })
})
