import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { estado, unico } from '#tests/ayudas'
import { crearServicio, nitAleatorio, sesionDirecta } from '#tests/portal/ayudas_portal'
import CanjearCodigoTelegram from '#notify/actions/canjear_codigo_telegram'
import { hashCodigoVinculacion } from '#notify/telegram/config'

/**
 * Vinculación de Telegram desde el portal (semana 2) contra Postgres y Redis reales, siguiendo
 * `contratos/telegram.md` de A6: el portal pide el código con `GenerarCodigoTelegram` y el bot lo
 * canjea con `CanjearCodigoTelegram` (aquí se llama como lo hace el webhook).
 */

const VARIABLES = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_NOMBRE',
    'TELEGRAM_CODIGO_VIGENCIA_S',
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_LIMITE_PETICIONES',
] as const

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.100.${(ipSecuencia % 250) + 1}`
}

function canjear(codigo: string, chatId: string, requestId = unico('req')) {
    return new CanjearCodigoTelegram().execute(
        { token_vinculacion: codigo, chat_id: chatId },
        { ...contextoSistema('webhook'), requestId },
    )
}

function vincular(client: ApiClient, cookie: string, requestId = unico('req')) {
    return client
        .post('/api/v1/portal/telegram/vincular')
        .header('Cookie', cookie)
        .header('X-Forwarded-For', ipNueva())
        .header('X-Request-Id', requestId)
}

async function pedirCodigo(client: ApiClient, cookie: string): Promise<string> {
    const respuesta = await estado(vincular(client, cookie), 201)
    return respuesta.body().codigo
}

async function chatDe(clienteId: number): Promise<string | null> {
    const fila = await db
        .from('core.clientes')
        .where('id', clienteId)
        .select('telegram_chat_id')
        .firstOrFail()
    return fila.telegram_chat_id
}

async function clienteConSesion(opciones: Parameters<typeof crearServicio>[0] = {}) {
    const s = await crearServicio({ nit: nitAleatorio(), ...opciones })
    const { cookie, sesionId } = await sesionDirecta(s.clienteId)
    return { ...s, cookie, sesionId }
}

test.group('Portal: vincular Telegram', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.TELEGRAM_BOT_TOKEN = '123456:token-de-prueba'
        process.env.TELEGRAM_BOT_NOMBRE = 'ArgosPruebaBot'
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-telegram')
        delete process.env.TELEGRAM_CODIGO_VIGENCIA_S
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('el portal pide el código, el bot lo canjea y el portal ve "vinculado"', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()

        const inicial = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.deepEqual(inicial.body(), { vinculado: false, disponible: true, bot: 'ArgosPruebaBot' })

        const req = unico('req')
        const vinculo = await estado(vincular(client, c.cookie, req), 201)
        const { codigo, enlace, bot, vence_en: vence } = vinculo.body()
        assert.match(codigo, /^[A-HJKMNP-Z2-9]{10}$/)
        assert.equal(enlace, `https://t.me/ArgosPruebaBot?start=${codigo}`)
        assert.equal(bot, 'ArgosPruebaBot')
        assert.approximately(new Date(vence).getTime() - Date.now(), 900_000, 5_000)
        assert.equal(vinculo.header('cache-control'), 'no-store')

        // solo el hash queda en la base; la auditoría (canal portal) no trae el código
        const fila = await db
            .from('notify.telegram_codigos')
            .where('cliente_id', c.clienteId)
            .select('codigo_hash', 'estado')
            .firstOrFail()
        assert.equal(fila.codigo_hash, hashCodigoVinculacion(codigo))
        const auditoria = await db
            .from('audit.acciones')
            .where({ request_id: req, accion: 'notificaciones.telegram_codigo' })
            .select('canal', 'entidad_id', 'entrada')
            .firstOrFail()
        assert.equal(auditoria.canal, 'portal')
        assert.equal(Number(auditoria.entidad_id), c.clienteId)
        assert.notInclude(JSON.stringify(auditoria), codigo)

        const resultado = await canjear(codigo, '987654321')
        assert.equal(resultado.cliente_id, c.clienteId)
        assert.equal(await chatDe(c.clienteId), '987654321')

        const final = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isTrue(final.body().vinculado)

        // ahora sí puede elegir Telegram como canal preferido
        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', c.cookie), 200)
        assert.isTrue(cuenta.body().cliente.telegram_vinculado)
        const editado = await estado(
            client
                .put('/api/v1/portal/contacto')
                .header('Cookie', c.cookie)
                .json({ canal_preferido: 'telegram', version: cuenta.body().cliente.version }),
            200,
        )
        assert.equal(editado.body().canal_preferido, 'telegram')
    })

    test('uso único: otro chat no reusa el código; el mismo chat (reintento) no cambia nada', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const codigo = await pedirCodigo(client, c.cookie)

        await canjear(codigo, '111111111')
        const reintento = await canjear(codigo, '111111111')
        assert.isTrue(reintento.repetido)

        await assert.rejects(() => canjear(codigo, '222222222'), /no es válido o ya venció/)
        assert.equal(await chatDe(c.clienteId), '111111111')
    })

    test('expiración: un código vencido no vincula', async ({ client, assert }) => {
        const c = await clienteConSesion()
        const codigo = await pedirCodigo(client, c.cookie)
        await db.rawQuery(
            "UPDATE notify.telegram_codigos SET vence_en = now() - interval '1 second' WHERE codigo_hash = ?",
            [hashCodigoVinculacion(codigo)],
        )
        await assert.rejects(() => canjear(codigo, '333333333'), /no es válido o ya venció/)
        assert.isNull(await chatDe(c.clienteId))
        const vista = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isFalse(vista.body().vinculado)
    })

    test('pedir otro código desde el portal invalida el anterior', async ({ client, assert }) => {
        const c = await clienteConSesion()
        const primero = await pedirCodigo(client, c.cookie)
        const segundo = await pedirCodigo(client, c.cookie)
        assert.notEqual(primero, segundo)
        await assert.rejects(() => canjear(primero, '444444444'), /no es válido o ya venció/)
        const ok = await canjear(segundo, '444444444')
        assert.equal(ok.cliente_id, c.clienteId)
    })

    test('intento de otro cliente: el código decide el cliente y la sesión de otro no ve ni toca el vínculo', async ({
        client,
        assert,
    }) => {
        const a = await clienteConSesion({ nombre: 'Ana Lucía Pérez' })
        const b = await clienteConSesion({ nombre: 'Bruno Castillo' })
        const codigoA = await pedirCodigo(client, a.cookie)
        // B pide su propio código: no reemplaza el de A
        const codigoB = await pedirCodigo(client, b.cookie)

        // el chat de B usa el código de A: vincula a A (el código manda), nunca a B
        const resultado = await canjear(codigoA, '555555555')
        assert.equal(resultado.cliente_id, a.clienteId)
        assert.isNull(await chatDe(b.clienteId))
        const vistaB = await estado(client.get('/api/v1/portal/telegram').header('Cookie', b.cookie), 200)
        assert.isFalse(vistaB.body().vinculado)

        // B desvincula desde su sesión: no afecta a A
        await estado(client.post('/api/v1/portal/telegram/desvincular').header('Cookie', b.cookie), 200)
        assert.equal(await chatDe(a.clienteId), '555555555')

        // el código de B sigue siendo solo de B
        const deB = await canjear(codigoB, '666666666')
        assert.equal(deB.cliente_id, b.clienteId)

        // sin sesión: 401 (y no se genera código)
        await estado(
            client.post('/api/v1/portal/telegram/vincular').header('X-Forwarded-For', ipNueva()),
            401,
        )
        await estado(client.get('/api/v1/portal/telegram'), 401)
        await estado(client.post('/api/v1/portal/telegram/desvincular'), 401)
    })

    test('desvincular quita el chat y devuelve el canal preferido a correo', async ({ client, assert }) => {
        const c = await clienteConSesion({ telegram: '777777777', canal: 'telegram' })
        const req = unico('req')
        const respuesta = await estado(
            client
                .post('/api/v1/portal/telegram/desvincular')
                .header('Cookie', c.cookie)
                .header('X-Request-Id', req),
            200,
        )
        assert.isFalse(respuesta.body().vinculado)
        const cliente = await db
            .from('core.clientes')
            .where('id', c.clienteId)
            .select('telegram_chat_id', 'canal_preferido')
            .firstOrFail()
        assert.isNull(cliente.telegram_chat_id)
        assert.equal(cliente.canal_preferido, 'correo')
        const acciones = await db.from('audit.acciones').where('request_id', req).select('accion', 'canal')
        assert.sameMembers(
            acciones.map((a) => a.accion),
            ['portal.desvincular_telegram', 'clientes.desvincular_telegram', 'clientes.editar'],
        )
        assert.isTrue(acciones.every((a) => a.canal === 'portal'))

        // repetir es idempotente
        await estado(client.post('/api/v1/portal/telegram/desvincular').header('Cookie', c.cookie), 200)
    })

    test('sin bot configurado: disponible false y 503 telegram_no_configurado', async ({
        client,
        assert,
    }) => {
        delete process.env.TELEGRAM_BOT_NOMBRE
        const c = await clienteConSesion()
        const vista = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isFalse(vista.body().disponible)
        assert.isNull(vista.body().bot)
        const respuesta = await estado(vincular(client, c.cookie), 503)
        assert.equal(respuesta.header('content-type')?.split(';')[0], 'application/problem+json')
        assert.match(respuesta.body().type, /telegram_no_configurado/)
    })

    test('límite de peticiones por IP al pedir códigos', async ({ client }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '2'
        const c = await clienteConSesion()
        const ip = ipNueva()
        const pedir = () =>
            client
                .post('/api/v1/portal/telegram/vincular')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ip)
        await estado(pedir(), 201)
        await estado(pedir(), 201)
        await estado(pedir(), 429)
    })
})
