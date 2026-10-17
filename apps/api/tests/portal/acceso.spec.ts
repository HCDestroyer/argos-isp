import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, unico } from '#tests/ayudas'
import {
    EnviadorFalso,
    cookieDeSesion,
    crearServicio,
    crearSesion,
    nitAleatorio,
    usarEnviadorCodigo,
} from '#tests/portal/ayudas_portal'
import { mascararCorreo } from '#portal/acceso/codigos'
import { MOTIVO_CODIGO_ACCESO } from '#portal/actions/solicitar_codigo'

/**
 * Acceso al portal por código (tarea 7) contra Postgres y Redis reales, con el enviador de
 * códigos falso. La IP del cliente viaja en X-Forwarded-For desde 127.0.0.1 (proxy confiable).
 */

const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_LIMITE_PETICIONES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_CODIGO_INTENTOS',
    'PORTAL_CODIGO_MAX_HORA',
] as const

let enviador: EnviadorFalso
let ipSecuencia = 0

/** Cada prueba sale de una IP distinta para no compartir el límite por IP. */
function ipNueva(): string {
    ipSecuencia += 1
    return `203.0.113.${(ipSecuencia % 250) + 1}`
}

test.group('Portal: acceso por código', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-acceso')
        delete process.env.PORTAL_LIMITE_PETICIONES
        delete process.env.PORTAL_CODIGO_INTENTOS
        delete process.env.PORTAL_CODIGO_MAX_HORA
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('por NIT: el código va al correo registrado y abre una sesión con cookie httpOnly', async ({
        client,
        assert,
    }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit, email: 'cliente.uno@example.com' })
        const ip = ipNueva()

        const pedido = await estado(
            client.post('/api/v1/portal/codigo').header('X-Forwarded-For', ip).json({ identificador: nit }),
            202,
        )
        assert.equal(pedido.body().destino, null)
        assert.match(pedido.body().solicitud, /^[0-9a-f-]{36}$/)
        assert.lengthOf(enviador.mensajes, 1)
        assert.equal(enviador.mensajes[0]!.canal, 'correo')
        assert.equal(enviador.mensajes[0]!.destino, 'cliente.uno@example.com')

        const codigo = enviador.ultimoCodigo()
        assert.equal(enviador.mensajes[0]!.asunto, `Tu código de acceso: ${codigo}`)

        // Enviado con EnviarMensajeDirecto (A6): una fila en notify.envios, sin el código en claro
        const envio = await db
            .from('notify.envios')
            .where('cliente_id', s.clienteId)
            .where('evento', MOTIVO_CODIGO_ACCESO)
            .firstOrFail()
        assert.include(envio, { canal: 'correo', destino: 'cliente.uno@example.com', estado: 'enviado' })
        assert.include(envio.cuerpo, '{{secreto}}')
        assert.notInclude(JSON.stringify(envio), codigo)
        const directo = await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.enviar_directo')
            .where('entidad_id', s.clienteId)
            .select('canal', 'entrada')
            .firstOrFail()
        assert.equal(directo.canal, 'portal')
        assert.notInclude(JSON.stringify(directo.entrada), codigo)
        const notificado = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [s.clienteId])
            .select('payload')
            .firstOrFail()
        assert.include(notificado.payload, { evento_origen: MOTIVO_CODIGO_ACCESO, estado: 'enviado' })

        const fila = await db
            .from('core.portal_codigos')
            .where('solicitud', pedido.body().solicitud)
            .select('codigo_hash', 'cliente_id')
            .firstOrFail()
        assert.equal(Number(fila.cliente_id), s.clienteId)
        assert.notInclude(fila.codigo_hash, codigo)

        const verificado = await estado(
            client
                .post('/api/v1/portal/verificar')
                .header('X-Forwarded-For', ip)
                .json({ solicitud: pedido.body().solicitud, codigo }),
            200,
        )
        assert.equal(verificado.body().cliente.nombre_parcial, 'María J.')
        assert.notProperty(verificado.body(), 'token')
        const setCookie = String(verificado.headers()['set-cookie'])
        assert.include(setCookie, 'HttpOnly')
        assert.include(setCookie, 'SameSite=Strict')
        assert.include(setCookie, 'Path=/api/v1/portal')
        const cookie = cookieDeSesion(verificado)!
        assert.match(cookie, /^argos_portal=pcs_/)

        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        assert.equal(cuenta.body().cliente.nombre, 'María José García López')
        assert.equal(cuenta.body().cliente.email, 'cliente.uno@example.com')
        assert.equal(cuenta.body().monto_adeudado, '399.75')
        assert.lengthOf(cuenta.body().servicios, 1)
        assert.equal(cuenta.body().servicios[0].estado, 'suspendido')

        const auditoria = await db
            .from('audit.acciones')
            .whereIn('accion', ['portal.solicitar_codigo', 'portal.verificar_codigo'])
            .where('entidad_id', s.clienteId)
            .select('accion', 'canal', 'resultado', 'entrada', 'actor_tipo', 'actor_id')
        assert.sameMembers(
            auditoria.map((a) => `${a.accion}:${a.canal}:${a.resultado}`),
            ['portal.solicitar_codigo:portal:ok', 'portal.verificar_codigo:portal:ok'],
        )
        // Pedir el código es anónimo; al verificarlo, el cliente queda como actor (como un login).
        const porAccion = Object.fromEntries(auditoria.map((a) => [a.accion, a]))
        assert.include(porAccion['portal.solicitar_codigo'], { actor_tipo: 'sistema', actor_id: null })
        assert.equal(porAccion['portal.verificar_codigo'].actor_tipo, 'cliente')
        assert.equal(Number(porAccion['portal.verificar_codigo'].actor_id), s.clienteId)
        assert.notInclude(JSON.stringify(auditoria), codigo)
    })

    test('por usuario PPPoE también identifica al cliente', async ({ client, assert }) => {
        const s = await crearServicio({ nit: nitAleatorio() })
        await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', ipNueva())
                .json({ identificador: s.userPpp }),
            202,
        )
        assert.lengthOf(enviador.mensajes, 1)
    })

    test('identificador desconocido o NIT compartido: misma respuesta y no se envía nada', async ({
        client,
        assert,
    }) => {
        // Dos clientes con el NIT de prueba compartido: no identifica a nadie.
        await crearServicio()
        await crearServicio()
        for (const identificador of ['1234567-8', 'no-existe-ppp', nitAleatorio()]) {
            const respuesta = await estado(
                client
                    .post('/api/v1/portal/codigo')
                    .header('X-Forwarded-For', ipNueva())
                    .json({ identificador }),
                202,
            )
            assert.deepEqual(Object.keys(respuesta.body()).sort(), ['destino', 'expira_en', 'solicitud'])
            assert.isNull(respuesta.body().destino)

            const intento = await estado(
                client
                    .post('/api/v1/portal/verificar')
                    .header('X-Forwarded-For', ipNueva())
                    .json({ solicitud: respuesta.body().solicitud, codigo: '123456' }),
                422,
            )
            assert.equal(intento.body().type, 'urn:argosisp:problema:codigo_invalido')
        }
        assert.lengthOf(enviador.mensajes, 0)
    })

    test('el destino nunca sale de la petición: un correo en el cuerpo se ignora', async ({
        client,
        assert,
    }) => {
        const nit = nitAleatorio()
        await crearServicio({ nit, email: 'registrado@example.com' })
        await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', ipNueva())
                .json({ identificador: nit, email: 'atacante@example.com', destino: 'atacante@example.com' }),
            202,
        )
        assert.equal(enviador.mensajes[0]!.destino, 'registrado@example.com')
    })

    test('Telegram si es el canal preferido y está vinculado; si no, correo', async ({ client, assert }) => {
        const conTelegram = nitAleatorio()
        await crearServicio({ nit: conTelegram, telegram: '777001', canal: 'telegram' })
        const sinCanalTelegram = nitAleatorio()
        await crearServicio({ nit: sinCanalTelegram, telegram: '777002', canal: 'telegram' })

        await client
            .post('/api/v1/portal/codigo')
            .header('X-Forwarded-For', ipNueva())
            .json({ identificador: conTelegram })
        assert.deepInclude(enviador.mensajes[0], { canal: 'telegram', destino: '777001' })

        enviador.canales = ['correo']
        await client
            .post('/api/v1/portal/codigo')
            .header('X-Forwarded-For', ipNueva())
            .json({ identificador: sinCanalTelegram })
        assert.deepInclude(enviador.mensajes[1], { canal: 'correo', destino: 'maria@example.com' })
    })

    test('desde /corte por IP: destino enmascarado; IP desconocida o sin destino responden 422', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ email: 'maria.garcia@example.com' })
        await crearSesion(s, { ipv4: '198.51.100.70' })
        const ok = await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', '198.51.100.70')
                .json({ por_ip: true }),
            202,
        )
        assert.equal(ok.body().destino, mascararCorreo('maria.garcia@example.com'))
        assert.equal(ok.body().destino, 'm***a@e***.com')

        const desconocida = await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', '198.51.100.71')
                .json({ por_ip: true }),
            422,
        )
        assert.equal(desconocida.body().type, 'urn:argosisp:problema:no_identificado')

        const sinCorreo = await crearServicio({ email: null })
        await crearSesion(sinCorreo, { ipv4: '198.51.100.72' })
        const sinDestino = await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', '198.51.100.72')
                .json({ por_ip: true }),
            422,
        )
        assert.equal(sinDestino.body().type, 'urn:argosisp:problema:sin_destino')
    })

    test('sin identificador ni por_ip responde 422', async ({ client }) => {
        await estado(client.post('/api/v1/portal/codigo').header('X-Forwarded-For', ipNueva()).json({}), 422)
    })

    test('código incorrecto cuenta intentos; agotados, ni el correcto entra', async ({ client, assert }) => {
        process.env.PORTAL_CODIGO_INTENTOS = '3'
        const nit = nitAleatorio()
        await crearServicio({ nit })
        const ip = ipNueva()
        const pedido = await estado(
            client.post('/api/v1/portal/codigo').header('X-Forwarded-For', ip).json({ identificador: nit }),
            202,
        )
        const codigo = enviador.ultimoCodigo()
        const malo = codigo === '000000' ? '111111' : '000000'
        const solicitud = pedido.body().solicitud

        const primero = await estado(
            client
                .post('/api/v1/portal/verificar')
                .header('X-Forwarded-For', ip)
                .json({ solicitud, codigo: malo }),
            422,
        )
        assert.include(primero.body().detail, 'Te quedan 2 intentos')
        await estado(
            client
                .post('/api/v1/portal/verificar')
                .header('X-Forwarded-For', ip)
                .json({ solicitud, codigo: malo }),
            422,
        )
        await estado(
            client
                .post('/api/v1/portal/verificar')
                .header('X-Forwarded-For', ip)
                .json({ solicitud, codigo: malo }),
            422,
        )
        const correctoTarde = await estado(
            client.post('/api/v1/portal/verificar').header('X-Forwarded-For', ip).json({ solicitud, codigo }),
            422,
        )
        assert.isNull(cookieDeSesion(correctoTarde))

        const fila = await db
            .from('core.portal_codigos')
            .where('solicitud', solicitud)
            .select('intentos')
            .firstOrFail()
        assert.equal(fila.intentos, 3)
        const errores = await db
            .from('audit.acciones')
            .where('accion', 'portal.verificar_codigo')
            .where('resultado', 'error')
            .whereRaw(`entrada->>'solicitud' = ?`, [solicitud])
            .count('* as n')
        assert.equal(Number(errores[0].n), 4)
    })

    test('código vencido, usado o reemplazado por uno nuevo no entra', async ({ client, assert }) => {
        const nit = nitAleatorio()
        await crearServicio({ nit })
        const ip = ipNueva()
        const pedir = () =>
            estado(
                client
                    .post('/api/v1/portal/codigo')
                    .header('X-Forwarded-For', ip)
                    .json({ identificador: nit }),
                202,
            )
        const verificar = (solicitud: string, codigo: string, status: number) =>
            estado(
                client
                    .post('/api/v1/portal/verificar')
                    .header('X-Forwarded-For', ip)
                    .json({ solicitud, codigo }),
                status,
            )

        const primero = await pedir()
        const codigoPrimero = enviador.ultimoCodigo()
        const segundo = await pedir()
        const codigoSegundo = enviador.ultimoCodigo()
        await verificar(primero.body().solicitud, codigoPrimero, 422)

        await verificar(segundo.body().solicitud, codigoSegundo, 200)
        await verificar(segundo.body().solicitud, codigoSegundo, 422)

        const tercero = await pedir()
        const codigoTercero = enviador.ultimoCodigo()
        await db
            .from('core.portal_codigos')
            .where('solicitud', tercero.body().solicitud)
            .update({ expira_en: db.knexRawQuery(`now() - interval '1 second'`) })
        await verificar(tercero.body().solicitud, codigoTercero, 422)
        assert.isTrue(true)
    })

    test('límite de códigos por cliente y hora: por IP 429, por identificador silencioso', async ({
        client,
        assert,
    }) => {
        process.env.PORTAL_CODIGO_MAX_HORA = '2'
        const nit = nitAleatorio()
        const s = await crearServicio({ nit })
        await crearSesion(s, { ipv4: '198.51.100.80' })
        for (let i = 0; i < 2; i += 1) {
            await estado(
                client
                    .post('/api/v1/portal/codigo')
                    .header('X-Forwarded-For', ipNueva())
                    .json({ identificador: nit }),
                202,
            )
        }
        assert.lengthOf(enviador.mensajes, 2)

        await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', ipNueva())
                .json({ identificador: nit }),
            202,
        )
        assert.lengthOf(enviador.mensajes, 2)

        const porIp = await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', '198.51.100.80')
                .json({ por_ip: true }),
            429,
        )
        assert.isAbove(Number(porIp.header('retry-after')), 0)
    })

    test('si el canal falla responde 503 y el código no queda guardado', async ({ client, assert }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit })
        enviador.fallar = true
        const respuesta = await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', ipNueva())
                .json({ identificador: nit }),
            503,
        )
        assert.equal(respuesta.body().type, 'urn:argosisp:problema:envio_codigo_fallido')
        const codigos = await db.from('core.portal_codigos').where('cliente_id', s.clienteId).count('* as n')
        assert.equal(Number(codigos[0].n), 0)
        // El intento fallido queda en notify.envios (transacción propia de EnviarMensajeDirecto)
        const envio = await db
            .from('notify.envios')
            .where('cliente_id', s.clienteId)
            .where('evento', MOTIVO_CODIGO_ACCESO)
            .firstOrFail()
        assert.equal(envio.estado, 'fallido')
        assert.include(envio.error, 'SMTP caído')
    })

    test('sin canal configurado (ni correo ni Telegram) por IP: 422 sin_destino y nada enviado', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ nit: nitAleatorio(), email: 'sin.canal@example.com' })
        const ip = ipNueva()
        await crearSesion(s, { ipv4: ip })
        enviador.canales = []
        const respuesta = await estado(
            client.post('/api/v1/portal/codigo').header('X-Forwarded-For', ip).json({ por_ip: true }),
            422,
        )
        assert.equal(respuesta.body().type, 'urn:argosisp:problema:sin_destino')
        assert.lengthOf(enviador.mensajes, 0)
        const envios = await db.from('notify.envios').where('cliente_id', s.clienteId).count('* as n')
        assert.equal(Number(envios[0].n), 0)
    })
})

/** Entra al portal como el cliente con `nit` y devuelve la cookie. */
async function entrar(client: ApiClient, nit: string): Promise<string> {
    const ip = ipNueva()
    const pedido = await client
        .post('/api/v1/portal/codigo')
        .header('X-Forwarded-For', ip)
        .json({ identificador: nit })
    const verificado = await client
        .post('/api/v1/portal/verificar')
        .header('X-Forwarded-For', ip)
        .json({ solicitud: pedido.body().solicitud, codigo: enviador.ultimoCodigo() })
    verificado.assertStatus(200)
    return cookieDeSesion(verificado)!
}

test.group('Portal: sesión y datos del cliente', (group) => {
    group.each.setup(() => {
        const previo = process.env.PORTAL_PROXIES_CONFIABLES
        const prefijo = process.env.PORTAL_REDIS_PREFIJO
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-sesion')
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            if (previo === undefined) delete process.env.PORTAL_PROXIES_CONFIABLES
            else process.env.PORTAL_PROXIES_CONFIABLES = previo
            if (prefijo === undefined) delete process.env.PORTAL_REDIS_PREFIJO
            else process.env.PORTAL_REDIS_PREFIJO = prefijo
        }
    })

    test('sin sesión, ninguna ruta del portal autenticado responde datos', async ({ client, assert }) => {
        const rutas = [
            client.get('/api/v1/portal/cuenta'),
            client.get('/api/v1/portal/facturas'),
            client.get('/api/v1/portal/facturas/1'),
            client.get('/api/v1/portal/pagos'),
            client.get('/api/v1/portal/promesas'),
            client.put('/api/v1/portal/contacto').json({ version: 1, email: 'x@example.com' }),
            client.get('/api/v1/portal/cuenta').header('Cookie', 'argos_portal=pcs_inventado'),
            client.get('/api/v1/portal/cuenta').header('Cookie', 'argos_portal=otra-cosa'),
        ]
        for (const peticion of rutas) {
            const respuesta = await estado(peticion, 401)
            assert.equal(respuesta.header('content-type'), 'application/problem+json; charset=utf-8')
        }
    })

    test('facturas, detalle, pagos y promesas solo del cliente de la sesión', async ({ client, assert }) => {
        const nit = nitAleatorio()
        const propio = await crearServicio({ nit, promesa: true })
        const ajeno = await crearServicio({ nit: nitAleatorio() })
        await db.table('billing.pagos').insert({
            cliente_id: propio.clienteId,
            metodo: 'deposito',
            monto: '50.25',
            referencia: 'DEP-1',
            estado: 'pendiente_verificacion',
        })
        await db
            .table('billing.pagos')
            .insert({ cliente_id: ajeno.clienteId, metodo: 'deposito', monto: '10.00' })
        const cookie = await entrar(client, nit)

        const facturas = await estado(client.get('/api/v1/portal/facturas').header('Cookie', cookie), 200)
        assert.lengthOf(facturas.body().data, 5)
        const vencida = facturas.body().data.find((f: { periodo: string }) => f.periodo === '2026-07-01')
        assert.include(vencida, {
            documento: 'aviso_cobro',
            saldo: '150.00',
            estado: 'vencida',
            numero: String(vencida.id),
        })
        const anulada = facturas.body().data.find((f: { estado: string }) => f.estado === 'anulada')
        assert.equal(anulada.saldo, '0.00')

        const paginada = await estado(
            client.get('/api/v1/portal/facturas?limit=2').header('Cookie', cookie),
            200,
        )
        assert.lengthOf(paginada.body().data, 2)
        assert.isString(paginada.body().nextCursor)

        const detalle = await estado(
            client.get(`/api/v1/portal/facturas/${vencida.id}`).header('Cookie', cookie),
            200,
        )
        assert.deepEqual(detalle.body().lineas, [])

        const facturaAjena = (await db
            .from('billing.facturas')
            .where('cliente_id', ajeno.clienteId)
            .select('id')
            .firstOrFail()) as { id: number }
        await estado(client.get(`/api/v1/portal/facturas/${facturaAjena.id}`).header('Cookie', cookie), 404)

        const pagos = await estado(client.get('/api/v1/portal/pagos').header('Cookie', cookie), 200)
        assert.lengthOf(pagos.body().data, 1)
        assert.include(pagos.body().data[0], {
            metodo: 'deposito',
            monto: '50.25',
            estado: 'pendiente_verificacion',
        })
        assert.notProperty(pagos.body().data[0], 'registrado_por')

        const promesas = await estado(client.get('/api/v1/portal/promesas').header('Cookie', cookie), 200)
        assert.lengthOf(promesas.body().data, 1)
        assert.include(promesas.body().data[0], {
            estado: 'activa',
            monto: '100.00',
            servicio_id: propio.servicioId,
        })
    })

    test('salir revoca la sesión y una sesión vencida pide código otra vez', async ({ client, assert }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit })
        const cookie = await entrar(client, nit)
        await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        const req = `salir-${s.clienteId}`
        const salida = await estado(
            client.post('/api/v1/portal/salir').header('Cookie', cookie).header('X-Request-Id', req),
            204,
        )
        assert.include(String(salida.headers()['set-cookie']), 'argos_portal=;')
        const cierre = await db.from('audit.acciones').where('request_id', req).firstOrFail()
        assert.include(cierre, { accion: 'portal.cerrar_sesion', actor_tipo: 'cliente', canal: 'portal' })
        assert.equal(Number(cierre.actor_id), s.clienteId)
        await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 401)

        const otra = await entrar(client, nit)
        await db
            .from('core.portal_sesiones')
            .where('cliente_id', s.clienteId)
            .whereNull('revocada_en')
            .update({ expira_en: db.knexRawQuery(`now() - interval '1 second'`) })
        const vencida = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', otra), 401)
        assert.include(vencida.body().detail, 'venció')
    })

    test('cada consulta extiende la sesión sin pasar de su máximo', async ({ client, assert }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit })
        const cookie = await entrar(client, nit)
        await db
            .from('core.portal_sesiones')
            .where('cliente_id', s.clienteId)
            .update({
                expira_en: db.knexRawQuery(`now() + interval '1 minute'`),
                expira_max_en: db.knexRawQuery(`now() + interval '5 minutes'`),
            })
        await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        const fila = await db
            .from('core.portal_sesiones')
            .where('cliente_id', s.clienteId)
            .select(db.raw('expira_en = expira_max_en AS en_maximo'))
            .firstOrFail()
        assert.isTrue(fila.en_maximo)
    })

    test('edita contacto y canal preferido con auditoría, canal portal y diff', async ({
        client,
        assert,
    }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit })
        const cookie = await entrar(client, nit)
        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        const version = cuenta.body().cliente.version

        const editado = await estado(
            client.put('/api/v1/portal/contacto').header('Cookie', cookie).json({
                version,
                email: 'nuevo@example.com',
                movil: '+502 5555-0000',
                nombre: 'Otro Nombre',
                canal_preferido: 'whatsapp',
            }),
            200,
        )
        assert.include(editado.body(), {
            email: 'nuevo@example.com',
            movil: '+502 5555-0000',
            canal_preferido: 'whatsapp',
            nombre: 'María José García López',
            version: version + 1,
        })

        const acciones = await db
            .from('audit.acciones')
            .where('entidad_tipo', 'cliente')
            .where('entidad_id', s.clienteId)
            .whereIn('accion', ['portal.editar_contacto', 'clientes.editar'])
            .select('accion', 'canal', 'actor_tipo', 'actor_id')
        assert.sameMembers(
            acciones.map((a) => `${a.accion}:${a.canal}:${a.actor_tipo}:${a.actor_id}`),
            [
                `portal.editar_contacto:portal:cliente:${s.clienteId}`,
                `clientes.editar:portal:cliente:${s.clienteId}`,
            ],
        )
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'cliente')
            .where('entidad_id', s.clienteId)
            .select('campo', 'actor_tipo', 'actor_id')
        assert.isTrue(cambios.every((c) => c.actor_tipo === 'cliente' && Number(c.actor_id) === s.clienteId))
        assert.sameMembers(
            cambios.map((c) => c.campo),
            ['email', 'movil', 'canal_preferido'],
        )

        await estado(
            client
                .put('/api/v1/portal/contacto')
                .header('Cookie', cookie)
                .json({ version, email: 'tarde@example.com' }),
            409,
        )
        const telegram = await estado(
            client
                .put('/api/v1/portal/contacto')
                .header('Cookie', cookie)
                .json({ version: version + 1, canal_preferido: 'telegram' }),
            422,
        )
        assert.equal(telegram.body().type, 'urn:argosisp:problema:telegram_no_vinculado')
    })
})
