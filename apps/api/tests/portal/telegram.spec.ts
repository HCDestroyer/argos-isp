import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { estado, unico } from '#tests/ayudas'
import { crearServicio, nitAleatorio, sesionDirecta } from '#tests/portal/ayudas_portal'
import CanjearVinculoTelegram from '#portal/actions/canjear_vinculo_telegram'
import { FORMATO_VINCULO, hashVinculo } from '#portal/acceso/telegram'
import { nombreParcial } from '#portal/consultas'
import type { ValidacionFallida } from '#shared/errores'

/**
 * Vinculación de Telegram desde el portal (semana 2, contrato `contratos/telegram.md`) contra
 * Postgres real. El bot de A6 se simula llamando `CanjearVinculoTelegram` como lo hará su webhook.
 */

const VARIABLES = ['PORTAL_TELEGRAM_BOT', 'PORTAL_TELEGRAM_VIGENCIA_S'] as const

function codigoDelEnlace(enlace: string): string {
    const url = new URL(enlace)
    return url.searchParams.get('start')!
}

function canjear(codigo: string, chatId: string, requestId = unico('req')) {
    return new CanjearVinculoTelegram().execute(
        { secreto: codigo, chat_id: chatId },
        { ...contextoSistema('webhook'), requestId },
    )
}

async function pedirCodigo(client: ApiClient, cookie: string): Promise<string> {
    const respuesta = await estado(
        client.post('/api/v1/portal/telegram/vincular').header('Cookie', cookie),
        201,
    )
    return codigoDelEnlace(respuesta.body().enlace)
}

async function clienteConSesion(opciones: Parameters<typeof crearServicio>[0] = {}) {
    const s = await crearServicio({ nit: nitAleatorio(), ...opciones })
    const { cookie, sesionId } = await sesionDirecta(s.clienteId)
    return { ...s, cookie, sesionId }
}

test.group('Portal: vincular Telegram', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_TELEGRAM_BOT = 'ArgosPruebaBot'
        delete process.env.PORTAL_TELEGRAM_VIGENCIA_S
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('genera un enlace de un solo uso; el bot lo canjea y el portal ve "vinculado"', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()

        const inicial = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.deepEqual(inicial.body(), {
            vinculado: false,
            disponible: true,
            bot: 'ArgosPruebaBot',
            pendiente_hasta: null,
        })

        const req = unico('req')
        const vinculo = await estado(
            client
                .post('/api/v1/portal/telegram/vincular')
                .header('Cookie', c.cookie)
                .header('X-Request-Id', req),
            201,
        )
        assert.match(vinculo.body().enlace, /^https:\/\/t\.me\/ArgosPruebaBot\?start=vt_[A-Za-z0-9_-]{32}$/)
        const codigo = codigoDelEnlace(vinculo.body().enlace)
        assert.match(codigo, FORMATO_VINCULO)

        // solo el hash queda en la base y en la auditoría no aparece el código
        const fila = await db
            .from('core.portal_vinculos_telegram')
            .where('cliente_id', c.clienteId)
            .select('codigo_hash', 'sesion_id', 'usado_en')
            .firstOrFail()
        assert.equal(fila.codigo_hash, hashVinculo(codigo))
        assert.notEqual(fila.codigo_hash, codigo)
        assert.equal(Number(fila.sesion_id), c.sesionId)
        const auditoria = await db
            .from('audit.acciones')
            .where({ request_id: req, accion: 'portal.generar_vinculo_telegram' })
            .select('canal', 'entidad_id', 'resultado', 'entrada')
            .firstOrFail()
        assert.equal(auditoria.canal, 'portal')
        assert.equal(Number(auditoria.entidad_id), c.clienteId)
        assert.notInclude(JSON.stringify(auditoria), codigo)

        const pendiente = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isFalse(pendiente.body().vinculado)
        assert.isString(pendiente.body().pendiente_hasta)

        const reqBot = unico('req')
        const resultado = await canjear(codigo, '987654321', reqBot)
        assert.deepEqual(resultado, {
            cliente_id: c.clienteId,
            nombre_parcial: nombreParcial('María José García López'),
            ya_vinculado: false,
        })

        const cliente = await db
            .from('core.clientes')
            .where('id', c.clienteId)
            .select('telegram_chat_id')
            .firstOrFail()
        assert.equal(cliente.telegram_chat_id, '987654321')
        const acciones = await db
            .from('audit.acciones')
            .where('request_id', reqBot)
            .orderBy('id')
            .select('accion', 'canal', 'entrada')
        assert.sameMembers(
            acciones.map((a) => a.accion),
            ['portal.canjear_vinculo_telegram', 'clientes.vincular_telegram'],
        )
        const canje = acciones.find((a) => a.accion === 'portal.canjear_vinculo_telegram')!
        assert.equal(canje.canal, 'webhook')
        assert.equal(canje.entrada.secreto, '***')

        const final = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isTrue(final.body().vinculado)
        assert.isNull(final.body().pendiente_hasta)

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

    test('uso único: otro chat no puede reusar el código; el mismo chat (reintento) recibe ya_vinculado', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const vinculo = await estado(
            client.post('/api/v1/portal/telegram/vincular').header('Cookie', c.cookie),
            201,
        )
        const codigo = codigoDelEnlace(vinculo.body().enlace)

        await canjear(codigo, '111111111')
        const reintento = await canjear(codigo, '111111111')
        assert.isTrue(reintento.ya_vinculado)
        assert.equal(reintento.cliente_id, c.clienteId)

        const req = unico('req')
        await assert.rejects(() => canjear(codigo, '222222222', req), /venció o ya se usó/)
        const cliente = await db
            .from('core.clientes')
            .where('id', c.clienteId)
            .select('telegram_chat_id')
            .firstOrFail()
        assert.equal(cliente.telegram_chat_id, '111111111')
        const error = await db
            .from('audit.acciones')
            .where({ request_id: req, accion: 'portal.canjear_vinculo_telegram' })
            .select('resultado')
            .firstOrFail()
        assert.equal(error.resultado, 'error')
    })

    test('expiración: un código vencido no vincula', async ({ client, assert }) => {
        const c = await clienteConSesion()
        const vinculo = await estado(
            client.post('/api/v1/portal/telegram/vincular').header('Cookie', c.cookie),
            201,
        )
        const codigo = codigoDelEnlace(vinculo.body().enlace)
        const expira = new Date(vinculo.body().expira_en).getTime()
        assert.approximately(expira - Date.now(), 900_000, 5_000)

        await db.rawQuery(
            "UPDATE core.portal_vinculos_telegram SET expira_en = now() - interval '1 second' WHERE codigo_hash = ?",
            [hashVinculo(codigo)],
        )

        await assert.rejects(() => canjear(codigo, '333333333'), /venció o ya se usó/)
        const cliente = await db
            .from('core.clientes')
            .where('id', c.clienteId)
            .select('telegram_chat_id')
            .firstOrFail()
        assert.isNull(cliente.telegram_chat_id)
        const vista = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isNull(vista.body().pendiente_hasta)
    })

    test('un código nuevo reemplaza al anterior sin usar; códigos inventados o de grupos no sirven', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const primero = await pedirCodigo(client, c.cookie)
        const segundo = await pedirCodigo(client, c.cookie)
        assert.notEqual(primero, segundo)
        await assert.rejects(() => canjear(primero, '444444444'), /venció o ya se usó/)
        await assert.rejects(() => canjear(`vt_${'A'.repeat(32)}`, '444444444'), /venció o ya se usó/)
        await assert.rejects(() => canjear('cualquier-cosa', '444444444'), /venció o ya se usó/)
        const grupo = (await canjear(segundo, '-1001234567').catch((e: unknown) => e)) as ValidacionFallida
        assert.equal(grupo.errores?.[0]?.rule, 'privado')
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
        // B genera su propio código: no reemplaza el de A
        const codigoB = await pedirCodigo(client, b.cookie)

        // el chat de B usa el código de A: vincula a A (el código manda), nunca a B
        const resultado = await canjear(codigoA, '555555555')
        assert.equal(resultado.cliente_id, a.clienteId)
        assert.equal(resultado.nombre_parcial, 'Ana L.')
        const vistaB = await estado(client.get('/api/v1/portal/telegram').header('Cookie', b.cookie), 200)
        assert.isFalse(vistaB.body().vinculado)
        assert.isString(vistaB.body().pendiente_hasta)

        // B desvincula: no afecta a A
        await estado(client.post('/api/v1/portal/telegram/desvincular').header('Cookie', b.cookie), 200)
        const clienteA = await db
            .from('core.clientes')
            .where('id', a.clienteId)
            .select('telegram_chat_id')
            .firstOrFail()
        assert.equal(clienteA.telegram_chat_id, '555555555')

        // y el código de B quedó anulado al desvincular
        await assert.rejects(() => canjear(codigoB, '666666666'), /venció o ya se usó/)

        // sin sesión: 401
        await estado(client.post('/api/v1/portal/telegram/vincular'), 401)
        await estado(client.get('/api/v1/portal/telegram'), 401)
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
        const acciones = await db.from('audit.acciones').where('request_id', req).select('accion')
        assert.sameMembers(
            acciones.map((a) => a.accion),
            ['portal.desvincular_telegram', 'clientes.desvincular_telegram', 'clientes.editar'],
        )

        // repetir es idempotente
        await estado(client.post('/api/v1/portal/telegram/desvincular').header('Cookie', c.cookie), 200)
    })

    test('sin bot configurado: disponible false y 503 telegram_no_configurado', async ({
        client,
        assert,
    }) => {
        delete process.env.PORTAL_TELEGRAM_BOT
        const c = await clienteConSesion()
        const vista = await estado(client.get('/api/v1/portal/telegram').header('Cookie', c.cookie), 200)
        assert.isFalse(vista.body().disponible)
        assert.isNull(vista.body().bot)
        const respuesta = await estado(
            client.post('/api/v1/portal/telegram/vincular').header('Cookie', c.cookie),
            503,
        )
        assert.equal(respuesta.header('content-type')?.split(';')[0], 'application/problem+json')
        assert.match(respuesta.body().type, /telegram_no_configurado/)
    })
})
