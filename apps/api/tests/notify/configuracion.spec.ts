import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import {
    configPara,
    configParaSync,
    dejarDeEscuchar,
    escucharInvalidaciones,
    fijarTransporteTelegram,
    publicarInvalidacion,
    recargarConfiguracion,
} from '#notify/configuracion'
import { ConsumidorNotify } from '#notify/consumidor'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { ConsumidorConfigNotify } from '#notify/consumidor_config'
import { fijarChatEquipo } from '#notify/alertas'
import ConfigurarNotificaciones, { type EntradaConfigurar } from '#notify/actions/configurar_notificaciones'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import EnviarMensajeDirecto from '#notify/actions/enviar_mensaje_directo'
import SembrarConfiguracionCanales from '#notify/actions/sembrar_configuracion_canales'
import {
    CanalFalso,
    ColaFalsa,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
    fetchTelegramFalso,
    respuestaTelegramOk,
    bloqueIdsEvento,
} from '#tests/notify/ayudas_notify'
import { SmtpFalso } from '#tests/notify/smtp_falso'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'

/**
 * Configuración de canales desde el panel: herencia global/empresa, interruptores, secretos que
 * nunca salen, prueba de envío (SMTP y Telegram falsos), recarga por evento y siembra desde el
 * entorno. La tabla se vacía antes y después de cada prueba: el resto de la suite corre con el
 * entorno como antes.
 */

const SMTP_PASSWORD = 'clave-smtp-super-secreta-1'
const TOKEN = `7770001:${'A'.repeat(35)}`
const TOKEN_EMPRESA = `8880002:${'B'.repeat(35)}`
const SECRETO_WEBHOOK = 'secreto-webhook-de-pruebas-0123456789'

async function limpiar() {
    await db.from('notify.configuracion_canales').delete()
    reiniciarCanales()
    fijarTransporteTelegram({})
    fijarChatEquipo(undefined)
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

/** Empresa real de `core.empresas` (la valida la acción); `soloEmpresaPrincipal()` la desactiva al terminar. */
function empresaUnica(): Promise<number> {
    return crearEmpresaFila()
}

async function textoAuditoria(requestIds: string[] = []): Promise<string> {
    const acciones = await db
        .from('audit.acciones')
        .whereIn('accion', ['notificaciones.configurar', 'notificaciones.sembrar_configuracion'])
        .select('entrada', 'error')
    const cambios = await db
        .from('audit.cambios')
        .where('entidad_tipo', 'configuracion_notificaciones')
        .select('antes', 'despues')
    const outbox = await db
        .from('audit.outbox')
        .where('evento', 'notificaciones.config_cambiada')
        .select('payload')
    const otras = requestIds.length ? await db.from('audit.acciones').whereIn('request_id', requestIds) : []
    return JSON.stringify([acciones, cambios, outbox, otras])
}

test.group('notify · configuración de canales · API y secretos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())
    group.each.setup(async () => {
        await limpiar()
        return () => limpiar()
    })

    test('sin configuración guardada, GET muestra el entorno; admin la crea con version 0 y los secretos salen como ***', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const inicial = await estado(
            client.get('/api/v1/notificaciones/configuracion').bearerToken(admin),
            200,
        )
        assert.equal(inicial.body().origen, 'entorno')
        assert.equal(inicial.body().version, 0)

        const guardada = await estado(
            client
                .put('/api/v1/notificaciones/configuracion')
                .bearerToken(admin)
                .json({
                    version: 0,
                    correo: {
                        host: 'smtp.isp.example',
                        puerto: 587,
                        tls: 'starttls',
                        usuario: 'avisos@isp.example',
                        password: SMTP_PASSWORD,
                        remitente: 'no-responder@isp.example',
                        nombre_visible: 'Mi ISP',
                    },
                    telegram: { token: TOKEN, bot_nombre: '@MiIspBot', chat_equipo: '-100123' },
                    avisos: { recordatorio: false },
                }),
            200,
        )
        const cuerpo = guardada.body()
        assert.containsSubset(cuerpo, {
            empresa_id: null,
            hereda: false,
            origen: 'guardada',
            version: 1,
            correo: {
                activo: true,
                host: 'smtp.isp.example',
                puerto: 587,
                tls: 'starttls',
                usuario: 'avisos@isp.example',
                password: '***',
                remitente: 'no-responder@isp.example',
                nombre_visible: 'Mi ISP',
            },
            telegram: {
                token: '***',
                bot_id: '7770001',
                bot_nombre: 'MiIspBot',
                chat_equipo: '-100123',
                // sin secreto del webhook se genera uno
                webhook_secreto: '***',
                webhook_ruta: '/api/v1/telegram/webhook/7770001',
            },
            avisos: { factura: true, recordatorio: false, corte: true },
        })

        // En la base, cifrados (formato v1 de app/shared/cifrado.ts)
        const fila = await db.from('notify.configuracion_canales').whereNull('empresa_id').firstOrFail()
        assert.match(fila.smtp_password_cifrada, /^v1\./)
        assert.match(fila.telegram_token_cifrado, /^v1\./)
        assert.match(fila.telegram_webhook_secreto_cifrado, /^v1\./)
        assert.notInclude(JSON.stringify(fila), SMTP_PASSWORD)
        assert.notInclude(JSON.stringify(fila), TOKEN)

        // El proceso ya usa la nueva configuración (invalidada al confirmar)
        const efectiva = await configPara(null)
        assert.equal(efectiva.correo.password, SMTP_PASSWORD)
        assert.equal(efectiva.telegram.token, TOKEN)

        // GET de nuevo: nada en claro
        const leida = await estado(client.get('/api/v1/notificaciones/configuracion').bearerToken(admin), 200)
        assert.notInclude(JSON.stringify(leida.body()), SMTP_PASSWORD)
        assert.notInclude(JSON.stringify(leida.body()), TOKEN)

        // Auditoría, cambios y evento: sin secretos
        const auditoria = await textoAuditoria()
        assert.notInclude(auditoria, SMTP_PASSWORD)
        assert.notInclude(auditoria, TOKEN)
        assert.notInclude(auditoria, 'AAAAAAAAAAAAAAAAAAAA')
        const cambioPassword = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'configuracion_notificaciones', campo: 'smtp_password_cifrada' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(cambioPassword.despues, '***')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'notificaciones.config_cambiada')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.containsSubset(evento.payload, { configuracion_id: cuerpo.id, empresa_id: null })
        assert.include(evento.payload.campos, 'smtp_password_cifrada')

        // Versión vieja → 409; reemplazar solo el host conserva la contraseña
        await estado(
            client.put('/api/v1/notificaciones/configuracion').bearerToken(admin).json({ version: 0 }),
            409,
        )
        await estado(
            client
                .put('/api/v1/notificaciones/configuracion')
                .bearerToken(admin)
                .json({ version: 1, correo: { host: 'smtp2.isp.example' } }),
            200,
        )
        const config1 = await configPara(null)
        assert.equal(config1.correo.password, SMTP_PASSWORD)
        const config2 = await configPara(null)
        assert.equal(config2.correo.host, 'smtp2.isp.example')
    })

    test('permisos: soporte ve la configuración pero no la cambia ni prueba; secreto inválido → 422', async ({
        client,
    }) => {
        const { token: soporte } = await usuarioConRoles(['soporte'])
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(client.get('/api/v1/notificaciones/configuracion').bearerToken(soporte), 200)
        await estado(
            client.put('/api/v1/notificaciones/configuracion').bearerToken(soporte).json({ version: 0 }),
            403,
        )
        await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(soporte)
                .json({ canal: 'correo', destino: 'x@prueba.local' }),
            403,
        )
        await estado(
            client
                .put('/api/v1/notificaciones/configuracion')
                .bearerToken(admin)
                .json({ version: 0, telegram: { token: 'no-es-un-token' } }),
            422,
        )
        // reenviar la máscara no la guarda como contraseña
        await estado(
            client
                .put('/api/v1/notificaciones/configuracion')
                .bearerToken(admin)
                .json({ version: 0, correo: { password: '***' } }),
            422,
        )
    })

    test('borrar un secreto con null y volver a reemplazarlo; la empresa sin fila hereda', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await configurar({ correo: { host: 'smtp.isp.example', password: SMTP_PASSWORD } })
        const sinPassword = await configurar({ correo: { password: null } })
        assert.isNull(sinPassword.correo.password)
        const config3 = await configPara(null)
        assert.isNull(config3.correo.password)

        const empresa = await empresaUnica()
        const vista = await estado(
            client.get(`/api/v1/notificaciones/configuracion/empresas/${empresa}`).bearerToken(admin),
            200,
        )
        assert.containsSubset(vista.body(), {
            id: null,
            empresa_id: empresa,
            hereda: true,
            origen: 'sin_configurar',
            version: 0,
        })
    })
})

test.group('notify · configuración de canales · herencia e interruptores', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())
    let correo: CanalFalso
    let telegram: CanalFalso

    group.each.setup(async () => {
        await limpiar()
        correo = new CanalFalso('correo')
        telegram = new CanalFalso('telegram')
        registrarCanal('correo', correo)
        registrarCanal('telegram', telegram)
        return () => limpiar()
    })

    async function facturaEmitida(opciones: { empresaId?: number; evento?: string } = {}) {
        const clienteId = await crearCliente({ canal_preferido: 'telegram', telegram_chat_id: '424242' })
        const servicioId = await crearServicio(clienteId, undefined, opciones.empresaId)
        const facturaId = await crearFactura(clienteId, servicioId)
        const evento = opciones.evento ?? 'factura.emitida'
        const payload: Record<string, unknown> = {
            factura_id: facturaId,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '150.00',
            vence: '2026-10-15',
        }
        if (opciones.empresaId) payload.empresa_id = opciones.empresaId
        const outboxId = await eventoOutbox(evento, payload)
        const cola = new ColaFalsa()
        await new ConsumidorNotify(cola).procesar({ id: outboxId, evento, payload })
        const envios = (await db
            .from('notify.envios')
            .where('origen', `outbox:${outboxId}`)
            .orderBy('canal')
            .select('id', 'canal', 'estado', 'motivo', 'empresa_id')) as Array<{
            id: number
            canal: string
            estado: string
            motivo: string | null
            empresa_id: number | null
        }>
        return { envios, cola }
    }

    test('la empresa hereda la global hasta tener la suya; con la suya manda la suya', async ({ assert }) => {
        const empresa = await empresaUnica()
        await configurar({ correo: { host: 'smtp.global.example', nombre_visible: 'Grupo' } })
        const config4 = await configPara(empresa)
        assert.equal(config4.origen, 'global')

        await configurar({ empresa_id: empresa, hereda: true, correo: { host: 'smtp.empresa.example' } })
        const config5 = await configPara(empresa)
        assert.equal(config5.correo.host, 'smtp.global.example')

        await configurar({ empresa_id: empresa, hereda: false })
        const propia = await configPara(empresa)
        assert.equal(propia.origen, 'empresa')
        assert.equal(propia.correo.host, 'smtp.empresa.example')
        // otra empresa y los avisos sin empresa siguen con la global
        const config6 = await configPara(empresa + 1)
        assert.equal(config6.correo.host, 'smtp.global.example')
        const config7 = await configPara(null)
        assert.equal(config7.correo.host, 'smtp.global.example')

        // Un aviso de esa empresa usa su configuración: correo apagado allí, encendido en la global
        await configurar({ empresa_id: empresa, correo: { activo: false } })
        const deEmpresa = await facturaEmitida({ empresaId: empresa })
        assert.deepEqual(
            deEmpresa.envios.map((e) => [e.canal, e.estado, e.empresa_id]),
            [
                ['correo', 'omitido', empresa],
                ['telegram', 'encolado', empresa],
            ],
        )
        assert.equal(
            deEmpresa.envios[0]!.motivo,
            `Correo apagado en la configuración de la empresa ${empresa}`,
        )
        // Sin empresa en el evento, el aviso toma la del servicio (la principal, 1), que no tiene
        // configuración propia: sale con la global.
        const global = await facturaEmitida()
        assert.deepEqual(
            global.envios.map((e) => [e.canal, e.estado, e.empresa_id]),
            [
                ['correo', 'encolado', 1],
                ['telegram', 'encolado', 1],
            ],
        )
    })

    test('tipo de aviso apagado: no se envía y queda omitido con motivo; los demás tipos salen', async ({
        assert,
    }) => {
        await configurar({ avisos: { factura: false } })
        const apagado = await facturaEmitida()
        assert.deepEqual(
            apagado.envios.map((e) => [e.canal, e.estado, e.motivo]),
            [
                ['correo', 'omitido', 'Aviso de tipo factura apagado en la configuración global'],
                ['telegram', 'omitido', 'Aviso de tipo factura apagado en la configuración global'],
            ],
        )
        assert.lengthOf(apagado.cola.ids, 0)
        // sin `notificacion.enviada` por lo omitido
        const omitido = await db.from('notify.envios').where('id', apagado.envios[0]!.id).firstOrFail()
        const clienteId = omitido.cliente_id
        const avisos = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw("(payload->>'cliente_id')::bigint = ?", [clienteId])
        assert.lengthOf(avisos, 0)

        const vencida = await facturaEmitida({ evento: 'factura.vencida' })
        assert.deepEqual(
            vencida.envios.map((e) => e.estado),
            ['encolado', 'encolado'],
        )
    })

    test('Telegram a clientes apagado: solo Telegram queda omitido; apagar después de encolar lo omite al enviar', async ({
        assert,
    }) => {
        await configurar({ telegram: { clientes_activo: false } })
        const { envios } = await facturaEmitida()
        assert.deepEqual(
            envios.map((e) => [e.canal, e.estado]),
            [
                ['correo', 'encolado'],
                ['telegram', 'omitido'],
            ],
        )
        assert.equal(envios[1]!.motivo, 'Telegram a clientes apagado en la configuración global')

        // Se apaga el correo con el envío ya en la cola: el worker no lo manda
        await configurar({ correo: { activo: false } })
        const resultado = await new EnviarNotificacion().execute(
            { envioId: envios[0]!.id, intento: 1, maxIntentos: 3 },
            contextoSistema('worker'),
        )
        assert.equal(resultado.estado, 'omitido')
        const fila = await db.from('notify.envios').where('id', envios[0]!.id).firstOrFail()
        assert.equal(fila.estado, 'omitido')
        assert.equal(fila.motivo, 'Correo apagado en la configuración global')
        assert.lengthOf(correo.enviados, 0)
    })

    test('alertas al equipo apagadas: la alerta queda omitida; el mensaje directo con correo apagado no sale', async ({
        assert,
    }) => {
        await configurar({ correo: { activo: false }, telegram: { alertas_activo: false } })
        fijarChatEquipo('-100555')
        const cola = new ColaFalsa()
        const nodo = unico('aaa-omitido')
        const id = await bloqueIdsEvento()
        await new ConsumidorAlertas(cola).procesar({
            id,
            evento: 'aaa.caido',
            payload: { nodo, desde: DateTime.utc().toISO() },
            requestId: `prueba-${id}`,
        })
        const incidente = await db.from('notify.incidentes').where('clave', `aaa:${nodo}`).firstOrFail()
        const alerta = await db
            .from('notify.envios')
            .whereLike('origen', `alerta:${incidente.id}:%`)
            .firstOrFail()
        assert.equal(alerta.estado, 'omitido')
        assert.equal(alerta.motivo, 'Alertas por Telegram apagadas en la configuración global')
        assert.lengthOf(cola.ids, 0)

        const clienteId = await crearCliente({ email: 'directo@prueba.local' })
        const directo = await new EnviarMensajeDirecto().execute(
            {
                cliente_id: clienteId,
                canal: 'correo',
                destino: 'directo@prueba.local',
                motivo: 'portal.codigo_acceso',
                cuerpo: 'Tu código es {{secreto}}',
                secreto: '123456',
            },
            contextoPrueba(),
        )
        assert.equal(directo.estado, 'fallido')
        assert.equal(directo.error, 'Correo apagado en la configuración global')
        const fila = await db.from('notify.envios').where('id', directo.envio_id).firstOrFail()
        assert.equal(fila.estado, 'omitido')
        assert.lengthOf(correo.enviados, 0)
    })
})

test.group('notify · configuración de canales · prueba de envío', (group) => {
    let smtp: SmtpFalso
    group.each.setup(async () => {
        await limpiar()
        smtp = await new SmtpFalso({ usuario: 'avisos', password: SMTP_PASSWORD }).iniciar()
        return async () => {
            await smtp.cerrar()
            await limpiar()
        }
    })

    test('correo: envía con la configuración guardada; con contraseña mala devuelve el error del servidor', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await configurar({
            correo: {
                host: '127.0.0.1',
                puerto: smtp.puerto,
                tls: 'ninguno',
                usuario: 'avisos',
                password: SMTP_PASSWORD,
                remitente: 'no-responder@isp.example',
                nombre_visible: 'Mi ISP',
            },
        })
        const bien = await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(admin)
                .json({ canal: 'correo', destino: 'admin@isp.example' }),
            200,
        )
        assert.containsSubset(bien.body(), { estado: 'enviado', error: null, origen: 'global' })
        assert.lengthOf(smtp.mensajes, 1)
        assert.deepEqual(smtp.mensajes[0]!.para, ['admin@isp.example'])
        assert.equal(smtp.mensajes[0]!.de, 'no-responder@isp.example')
        assert.include(smtp.mensajes[0]!.datos, 'Mi ISP')
        const envio = await db.from('notify.envios').where('id', bien.body().envio_id).firstOrFail()
        assert.containsSubset(envio, { evento: 'notificaciones.prueba', estado: 'enviado', cliente_id: null })

        // Con el correo apagado la prueba igual sale (se prueba antes de encender)
        await configurar({ correo: { activo: false, password: 'otra-clave-equivocada' } })
        const mala = await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(admin)
                .json({ canal: 'correo', destino: 'admin@isp.example' }),
            200,
        )
        assert.equal(mala.body().estado, 'fallido')
        assert.include(mala.body().error, '535')
        assert.include(mala.body().error, 'Authentication failed')
        assert.lengthOf(smtp.mensajes, 1)

        // Correo sin destino → 422
        await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(admin)
                .json({ canal: 'correo' }),
            422,
        )
    })

    test('correo: el aviso de una factura sale por el SMTP de la configuración, sin reiniciar', async ({
        assert,
    }) => {
        await configurar({
            correo: {
                host: '127.0.0.1',
                puerto: smtp.puerto,
                tls: 'ninguno',
                usuario: 'avisos',
                password: SMTP_PASSWORD,
                remitente: 'facturas@isp.example',
            },
        })
        const clienteId = await crearCliente({ email: 'cliente-smtp@prueba.local' })
        const servicioId = await crearServicio(clienteId)
        const facturaId = await crearFactura(clienteId, servicioId)
        const payload = { factura_id: facturaId, servicio_id: servicioId, cliente_id: clienteId }
        const outboxId = await eventoOutbox('factura.emitida', payload)
        const cola = new ColaFalsa()
        await new ConsumidorNotify(cola).procesar({ id: outboxId, evento: 'factura.emitida', payload })
        assert.lengthOf(cola.ids, 1)
        const resultado = await new EnviarNotificacion().execute(
            { envioId: cola.ids[0]!, intento: 1, maxIntentos: 3 },
            contextoSistema('worker'),
        )
        assert.equal(resultado.estado, 'enviado')
        assert.deepEqual(smtp.mensajes[0]!.para, ['cliente-smtp@prueba.local'])
        assert.equal(smtp.mensajes[0]!.de, 'facturas@isp.example')
    })

    test('Telegram: prueba al chat del equipo con el bot guardado; token rechazado devuelve el 401 de la Bot API', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        let rechazar = false
        const api = fetchTelegramFalso((_metodo, cuerpo) =>
            rechazar
                ? { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } }
                : respuestaTelegramOk(cuerpo),
        )
        fijarTransporteTelegram({ fetch: api.fetch, apiRoot: 'http://telegram.prueba' })
        await configurar({ telegram: { token: TOKEN, chat_equipo: '-100777' } })

        const bien = await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(admin)
                .json({ canal: 'telegram' }),
            200,
        )
        assert.containsSubset(bien.body(), { estado: 'enviado', destino: '-100777' })
        assert.include(api.llamadas[0]!.url, `/bot${TOKEN}/sendMessage`)
        assert.equal(api.llamadas[0]!.cuerpo.chat_id, '-100777')

        rechazar = true
        const mala = await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(admin)
                .json({ canal: 'telegram', destino: '12345' }),
            200,
        )
        assert.containsSubset(mala.body(), { estado: 'fallido', destino: '12345' })
        assert.include(mala.body().error, '401 Unauthorized')
    })

    test('Mailpit (CI): prueba de correo con la configuración guardada', async ({ client, assert }) => {
        const mailpit = process.env.MAILPIT_API!
        const { token: admin } = await usuarioConRoles(['admin'])
        await configurar({
            correo: {
                host: process.env.SMTP_HOST!,
                puerto: Number(process.env.SMTP_PORT ?? 1025),
                tls: 'ninguno',
                remitente: 'no-responder@isp.example',
                nombre_visible: 'Prueba panel',
            },
        })
        const destino = `${unico('panel')}@prueba.local`
        const respuesta = await estado(
            client
                .post('/api/v1/notificaciones/configuracion/probar')
                .bearerToken(admin)
                .json({ canal: 'correo', destino }),
            200,
        )
        assert.equal(respuesta.body().estado, 'enviado')
        const busqueda = await fetch(
            `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${destino}"`)}`,
        )
        const json = (await busqueda.json()) as { messages: Array<{ Subject: string }> }
        assert.equal(json.messages[0]?.Subject, 'Prueba de notificaciones de ArgosIsp')
    })
        .skip(
            !process.env.MAILPIT_API || !process.env.SMTP_HOST,
            'Requiere MAILPIT_API y SMTP_HOST (Mailpit)',
        )
        .timeout(15_000)
})

test.group('notify · configuración de canales · webhook por bot', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())
    group.each.setup(async () => {
        await limpiar()
        return () => limpiar()
    })

    test('cada bot tiene su URL y su secreto; responde por el mismo bot', async ({ client, assert }) => {
        const api = fetchTelegramFalso((_metodo, cuerpo) => respuestaTelegramOk(cuerpo))
        fijarTransporteTelegram({ fetch: api.fetch, apiRoot: 'http://telegram.prueba' })
        const empresa = await empresaUnica()
        await configurar({ telegram: { token: TOKEN, webhook_secreto: SECRETO_WEBHOOK } })
        await configurar({
            empresa_id: empresa,
            hereda: false,
            telegram: { token: TOKEN_EMPRESA, webhook_secreto: `${SECRETO_WEBHOOK}-e` },
        })
        const actualizacion = (texto: string) => ({
            update_id: randomInt(1, 1_000_000_000),
            message: { message_id: 1, chat: { id: 5551234, type: 'private' }, text: texto },
        })

        await estado(
            client
                .post('/api/v1/telegram/webhook/7770001')
                .header('X-Telegram-Bot-Api-Secret-Token', SECRETO_WEBHOOK)
                .json(actualizacion('/ayuda')),
            200,
        )
        assert.include(api.llamadas.at(-1)!.url, `/bot${TOKEN}/sendMessage`)

        await estado(
            client
                .post('/api/v1/telegram/webhook/8880002')
                .header('X-Telegram-Bot-Api-Secret-Token', `${SECRETO_WEBHOOK}-e`)
                .json(actualizacion('/ayuda')),
            200,
        )
        assert.include(api.llamadas.at(-1)!.url, `/bot${TOKEN_EMPRESA}/sendMessage`)

        const llamadas = api.llamadas.length
        // secreto de otro bot, bot desconocido y sin secreto: 401
        await estado(
            client
                .post('/api/v1/telegram/webhook/8880002')
                .header('X-Telegram-Bot-Api-Secret-Token', SECRETO_WEBHOOK)
                .json(actualizacion('/ayuda')),
            401,
        )
        await estado(
            client
                .post('/api/v1/telegram/webhook/1234567')
                .header('X-Telegram-Bot-Api-Secret-Token', SECRETO_WEBHOOK)
                .json(actualizacion('/ayuda')),
            401,
        )
        await estado(client.post('/api/v1/telegram/webhook/7770001').json(actualizacion('/ayuda')), 401)
        assert.equal(api.llamadas.length, llamadas)

        // La ruta sin id sigue siendo la del bot global
        await estado(
            client
                .post('/api/v1/telegram/webhook')
                .header('X-Telegram-Bot-Api-Secret-Token', SECRETO_WEBHOOK)
                .json(actualizacion('/ayuda')),
            200,
        )
        assert.include(api.llamadas.at(-1)!.url, `/bot${TOKEN}/sendMessage`)
    })
})

test.group('notify · configuración de canales · recarga y siembra', (group) => {
    group.each.setup(async () => {
        await limpiar()
        return async () => {
            await dejarDeEscuchar()
            await limpiar()
        }
    })

    test('notificaciones.config_cambiada: el consumidor del worker recarga sin reiniciar', async ({
        assert,
    }) => {
        await configurar({ correo: { host: 'smtp.antes.example' } })
        const config8 = await configPara(null)
        assert.equal(config8.correo.host, 'smtp.antes.example')

        // Otro proceso cambió la base: la caché de este no se entera sola (no hay TTL)
        await db
            .from('notify.configuracion_canales')
            .whereNull('empresa_id')
            .update({ smtp_host: 'smtp.despues.example', version: db.knexRawQuery('version + 1') })
        const config9 = await configPara(null)
        assert.equal(config9.correo.host, 'smtp.antes.example')

        const consumidor = new ConsumidorConfigNotify()
        assert.isTrue(consumidor.acepta('notificaciones.config_cambiada'))
        assert.isFalse(consumidor.acepta('factura.emitida'))
        await consumidor.procesar({
            id: 1,
            evento: 'notificaciones.config_cambiada',
            payload: { configuracion_id: 1, empresa_id: null, campos: ['smtp_host'] },
        })
        const config10 = await configPara(null)
        assert.equal(config10.correo.host, 'smtp.despues.example')
    })

    test('el aviso por Redis Pub/Sub recarga los demás procesos', async ({ assert }) => {
        await configurar({ correo: { host: 'smtp.uno.example' } })
        await escucharInvalidaciones()
        await configPara(null)
        await db
            .from('notify.configuracion_canales')
            .whereNull('empresa_id')
            .update({ smtp_host: 'smtp.dos.example' })
        await publicarInvalidacion()
        const limite = Date.now() + 3000
        while (configParaSync(null).correo.host !== 'smtp.dos.example' && Date.now() < limite) {
            await new Promise((resolver) => setTimeout(resolver, 25))
        }
        assert.equal(configParaSync(null).correo.host, 'smtp.dos.example')
    })

    test('siembra desde el entorno una sola vez; después manda el panel', async ({ client, assert }) => {
        const entorno = {
            SMTP_HOST: 'smtp.entorno.example',
            SMTP_PORT: '2525',
            SMTP_USER: 'usuario-entorno',
            SMTP_PASSWORD: SMTP_PASSWORD,
            MAIL_FROM: 'ISP Entorno <avisos@entorno.example>',
            TELEGRAM_BOT_TOKEN: TOKEN,
            TELEGRAM_BOT_NOMBRE: '@EntornoBot',
            TELEGRAM_CHAT_EQUIPO: '-100999',
            TELEGRAM_WEBHOOK_SECRET: SECRETO_WEBHOOK,
            AAA_PPP_KEY: 'no-debe-aparecer-en-auditoria',
        }
        assert.containsSubset(
            await new SembrarConfiguracionCanales({}).execute({}, contextoSistema('consola')),
            { sembrada: false, motivo: 'entorno_vacio' },
        )

        const ctx = contextoSistema('consola')
        const sembrada = await new SembrarConfiguracionCanales(entorno).execute({}, ctx)
        assert.containsSubset(sembrada, { sembrada: true, motivo: null })
        assert.include(sembrada.variables, 'SMTP_PASSWORD')

        const { token: admin } = await usuarioConRoles(['admin'])
        const vista = await estado(client.get('/api/v1/notificaciones/configuracion').bearerToken(admin), 200)
        assert.containsSubset(vista.body(), {
            origen: 'guardada',
            sembrada_desde_entorno: true,
            version: 1,
            correo: {
                host: 'smtp.entorno.example',
                puerto: 2525,
                tls: 'auto',
                usuario: 'usuario-entorno',
                password: '***',
                remitente: 'avisos@entorno.example',
                nombre_visible: 'ISP Entorno',
            },
            telegram: {
                token: '***',
                bot_id: '7770001',
                bot_nombre: 'EntornoBot',
                chat_equipo: '-100999',
                webhook_secreto: '***',
            },
        })
        const efectiva = await configPara(null)
        assert.equal(efectiva.correo.password, SMTP_PASSWORD)
        assert.equal(efectiva.telegram.webhookSecreto, SECRETO_WEBHOOK)

        // Auditada, sin secretos ni el entorno
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'notificaciones.sembrar_configuracion', request_id: ctx.requestId })
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
        const auditoria = await textoAuditoria([ctx.requestId])
        assert.notInclude(auditoria, SMTP_PASSWORD)
        assert.notInclude(auditoria, TOKEN)
        assert.notInclude(auditoria, SECRETO_WEBHOOK)
        assert.notInclude(auditoria, 'no-debe-aparecer-en-auditoria')

        // El panel cambia el host; sembrar de nuevo (otro arranque) no lo pisa
        await configurar({ correo: { host: 'smtp.panel.example' } })
        const otra = await new SembrarConfiguracionCanales({
            ...entorno,
            SMTP_HOST: 'smtp.otro.example',
        }).execute({}, contextoSistema('consola'))
        assert.containsSubset(otra, { sembrada: false, motivo: 'ya_configurada' })
        const config11 = await configPara(null)
        assert.equal(config11.correo.host, 'smtp.panel.example')
        assert.lengthOf(await db.from('notify.configuracion_canales'), 1)
    })
})
