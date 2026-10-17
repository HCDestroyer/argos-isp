import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearEmpresaFila, crearRouterFila } from '#tests/core/fabricas'
import { cuentaBancariaPrueba, escenario, generar } from '#tests/billing/ayudas_billing'
import { EnviadorFalso, sesionDirecta, usarEnviadorCodigo } from '#tests/portal/ayudas_portal'
import { fetchTelegramFalso, respuestaTelegramOk } from '#tests/notify/ayudas_notify'
import { reiniciarCanales } from '#notify/canales/registro'
import { fijarTransporteTelegram, recargarConfiguracion } from '#notify/configuracion'
import ConfigurarNotificaciones, { type EntradaConfigurar } from '#notify/actions/configurar_notificaciones'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * Multiempresa en el portal con dos empresas (Cable Norte y Fibra Sur), contra Postgres real:
 * cuentas de depósito por empresa, comprobante a la cuenta de otra empresa (422 claro), pago en
 * línea que nunca mezcla empresas, `/cuenta` con saldo y facturas por empresa y la vinculación de
 * Telegram por bot (`contratos/multiempresa.md`, `contratos/telegram.md` "Varios bots").
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-multiempresa'),
])

const hoy = () => DateTime.now().setZone('America/Guatemala').startOf('day')
const dia = (dias: number) => hoy().plus({ days: dias }).toISODate()!

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.109.${(ipSecuencia % 250) + 1}`
}

/** Cuerpo de una respuesta con el status esperado. */
async function leer(peticion: PromiseLike<ApiResponse>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

function entornoPortal(prefijo: string) {
    const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
    process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
    process.env.PORTAL_REDIS_PREFIJO = unico(prefijo)
    delete process.env.PORTAL_LIMITE_PETICIONES
    return () => {
        for (const variable of VARIABLES) {
            if (previo[variable] === undefined) delete process.env[variable]
            else process.env[variable] = previo[variable]
        }
    }
}

/**
 * Servicio cortado de `empresaId` (facturas generadas por A3, con sus asientos), con su sesión de
 * red en una IP nueva. Con `clienteId`, otro servicio del mismo cliente.
 */
async function cortado(empresaId: number, clienteId?: number) {
    const routerId = await crearRouterFila()
    const datos = await escenario({
        fecha_instalacion: dia(-75),
        plantilla: { hora_corte: '00:00' },
        servicio: {
            router_id: routerId,
            empresa_id: empresaId,
            ...(clienteId === undefined ? {} : { cliente_id: clienteId }),
        },
    })
    await generar(datos.servicioId, dia(0))
    await new VencerFacturas().execute({ servicio_id: datos.servicioId, hasta: dia(0) }, contextoPrueba())
    await new EvaluarEstadoServicio().execute({ servicio_id: datos.servicioId }, contextoPrueba())
    const ip = ipNueva()
    await db.table('network.sesiones').insert({
        servicio_id: datos.servicioId,
        router_id: routerId,
        nas_ip: '192.0.2.1',
        acct_session_id: unico('acct'),
        user_ppp: unico('ppp'),
        ipv4: ip,
    })
    return { servicioId: datos.servicioId, clienteId: clienteId ?? datos.clienteId, ip }
}

/** Un cliente con un servicio cortado en Norte y otro en Sur, y su sesión del portal. */
async function dosEmpresas() {
    const norte = await crearEmpresaFila({ nombre_comercial: unico('Cable Norte') })
    const sur = await crearEmpresaFila({ nombre_comercial: unico('Fibra Sur') })
    const deNorte = await cortado(norte)
    const deSur = await cortado(sur, deNorte.clienteId)
    const { cookie } = await sesionDirecta(deNorte.clienteId)
    return { norte, sur, deNorte, deSur, clienteId: deNorte.clienteId, cookie }
}

async function pendientesDe(servicioId: number) {
    return (await db
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .orderBy('id')
        .select('id', 'empresa_id', db.raw('(total - pagado)::text as saldo'))) as Array<{
        id: number
        empresa_id: number
        saldo: string
    }>
}

function subirComprobante(client: ApiClient, ip: string, cuentaId: number): ApiRequest {
    return client
        .post('/api/v1/portal/comprobantes')
        .header('X-Forwarded-For', ip)
        .field('metodo', 'deposito')
        .field('cuenta_bancaria_id', String(cuentaId))
        .field('referencia', unico('boleta'))
        .field('monto', '150.00')
        .field('fecha_deposito', dia(0))
        .file('archivo', PNG, { filename: 'boleta.png' })
}

test.group('Portal: dos empresas (cuentas, comprobante, pago en línea, cuenta)', (group) => {
    group.each.setup(() => {
        const restaurar = entornoPortal('prueba-multiempresa')
        const enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return async () => {
            usarEnviadorCodigo(undefined)
            restaurar()
            await soloEmpresaPrincipal()
        }
    })

    test('cuentas de depósito: cada empresa muestra solo las suyas, por IP y por empresa_id', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const deNorte = await cuentaBancariaPrueba('Banrural', e.norte)
        const deSur = await cuentaBancariaPrueba('Banrural', e.sur)
        const principal = await cuentaBancariaPrueba('Banrural', 1)
        const ids = async (peticion: ApiRequest) =>
            ((await leer(peticion, 200)) as { cuentas_deposito: Array<{ id: number }> }).cuentas_deposito.map(
                (c) => c.id,
            )

        // /corte por IP: la empresa del servicio de esa IP
        const porIpSur = await ids(client.get('/api/v1/portal/empresa').header('X-Forwarded-For', e.deSur.ip))
        assert.include(porIpSur, deSur.id)
        assert.notInclude(porIpSur, deNorte.id)
        assert.notInclude(porIpSur, principal.id)
        const porIpNorte = await ids(
            client.get('/api/v1/portal/empresa').header('X-Forwarded-For', e.deNorte.ip),
        )
        assert.include(porIpNorte, deNorte.id)
        assert.notInclude(porIpNorte, deSur.id)

        // /cuenta: una sección por empresa con `empresa_id`
        const deSurPorId = await ids(
            client.get(`/api/v1/portal/empresa?empresa_id=${e.sur}`).header('Cookie', e.cookie),
        )
        assert.deepEqual(deSurPorId, [deSur.id])
        assert.include(await ids(client.get('/api/v1/portal/empresa?empresa_id=1')), principal.id)
    })

    test('comprobante a la cuenta de otra empresa: 422 cuenta_de_otra_empresa claro, sin ids internos', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const deNorte = await cuentaBancariaPrueba('Banrural', e.norte)
        const deSur = await cuentaBancariaPrueba('Banrural', e.sur)

        // El servicio de esta IP es de Sur y la cuenta es de Norte
        const rechazo = await estado(subirComprobante(client, e.deSur.ip, deNorte.id), 422)
        const problema = rechazo.body()
        assert.equal(problema.type, 'urn:argosisp:problema:cuenta_de_otra_empresa')
        assert.equal(problema.title, 'Cuenta de otra empresa')
        assert.include(problema.detail, 'otra empresa')
        assert.deepEqual(problema.errors, [
            {
                field: 'cuenta_bancaria_id',
                message: 'Esa cuenta es de otra empresa. Elige una de las cuentas de tu servicio.',
                rule: 'cuenta_de_otra_empresa',
            },
        ])
        // El detalle de A3 nombra la cuenta, las empresas y el servicio: el cliente no los ve
        assert.notInclude(problema.detail, String(deNorte.id))
        assert.notInclude(problema.detail, String(e.deSur.servicioId))
        const comprobantes = await db
            .from('billing.comprobantes')
            .where('cliente_id', e.clienteId)
            .select('id')
        assert.lengthOf(comprobantes, 0)

        // A su propia cuenta, sí: el comprobante queda en la empresa del servicio
        const recibido = await estado(subirComprobante(client, e.deSur.ip, deSur.id), 201)
        const fila = await db.from('billing.comprobantes').where('id', recibido.body().id).firstOrFail()
        assert.equal(Number(fila.empresa_id), e.sur)
    })

    test('pago en línea: nunca mezcla empresas; por servicio o con facturas de una sola', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const norte = await pendientesDe(e.deNorte.servicioId)
        const sur = await pendientesDe(e.deSur.servicioId)
        assert.isAbove(norte.length, 0)
        assert.isAbove(sur.length, 0)

        const iniciar = (cuerpo: Record<string, unknown>) =>
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('Cookie', e.cookie)
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', unico('pago'))
                .json(cuerpo)

        // Facturas de las dos empresas: 422 y ningún cobro
        const mezcla = await estado(iniciar({ facturas: [norte[0]!.id, sur[0]!.id] }), 422)
        assert.equal(mezcla.body().type, 'urn:argosisp:problema:pago_de_varias_empresas')
        assert.include(mezcla.body().detail, 'una sola empresa')
        const cobros = () =>
            db.from('billing.pasarela_cobros').where('cliente_id', e.clienteId).orderBy('id').select('*')
        assert.lengthOf(await cobros(), 0)

        // Por servicio: el cobro es de la empresa del servicio
        const porServicio = await estado(iniciar({ servicio_id: e.deSur.servicioId }), 201)
        const porFacturas = await estado(iniciar({ facturas: norte.map((f) => f.id) }), 201)
        const filas = await cobros()
        assert.deepEqual(
            filas.map((c) => [Number(c.id), Number(c.empresa_id)]),
            [
                [porServicio.body().id, e.sur],
                [porFacturas.body().id, e.norte],
            ],
        )

        // Por IP (/corte) también: la empresa del servicio de esa IP
        const porIp = await estado(
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', e.deNorte.ip)
                .header('Idempotency-Key', unico('pago'))
                .json({}),
            201,
        )
        const cobroIp = await db.from('billing.pasarela_cobros').where('id', porIp.body().id).firstOrFail()
        assert.equal(Number(cobroIp.empresa_id), e.norte)
    })

    test('/cuenta: saldo y facturas pendientes por empresa (estado de cuenta de A3)', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const cuenta = await leer(client.get('/api/v1/portal/cuenta').header('Cookie', e.cookie), 200)

        assert.lengthOf(cuenta.empresas, 2)
        // La principal del cliente primero (a igualdad de servicios, la del más antiguo: Norte)
        assert.equal(cuenta.empresa_principal.id, e.norte)
        assert.deepEqual(
            cuenta.empresas.map((s: { empresa: { id: number } }) => s.empresa.id),
            [e.norte, e.sur],
        )
        for (const [indice, servicioId] of [e.deNorte.servicioId, e.deSur.servicioId].entries()) {
            const seccion = cuenta.empresas[indice]
            const pendientes = await pendientesDe(servicioId)
            const total = pendientes.reduce((s, f) => s + Math.round(Number(f.saldo) * 100), 0) / 100
            assert.equal(seccion.saldo, total.toFixed(2))
            assert.equal(seccion.saldo_a_favor, '0.00')
            assert.deepEqual(
                seccion.facturas_pendientes.map((f: { id: number }) => f.id),
                pendientes.map((f) => Number(f.id)),
            )
            for (const factura of seccion.facturas_pendientes) {
                assert.equal(factura.servicio_id, servicioId)
                assert.sameMembers(Object.keys(factura), [
                    'id',
                    'numero',
                    'servicio_id',
                    'vence_en',
                    'estado',
                    'vencida',
                    'total',
                    'saldo',
                ])
            }
            assert.isTrue(seccion.facturas_pendientes.some((f: { vencida: boolean }) => f.vencida))
            // El saldo de la sección coincide con lo que debe el servicio de esa empresa
            const servicio = cuenta.servicios.find((s: { id: number }) => s.id === servicioId)
            assert.equal(servicio.monto_adeudado, seccion.saldo)
            assert.equal(servicio.empresa.id, seccion.empresa.id)
        }
    })
})

const TOKEN_GLOBAL = `7770011:${'C'.repeat(35)}`
const TOKEN_SUR = `8880012:${'D'.repeat(35)}`
const SECRETO_GLOBAL = 'secreto-webhook-global-portal-0123'
const SECRETO_SUR = 'secreto-webhook-sur-portal-0123456'

async function limpiarNotify() {
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

test.group('Portal: Telegram por empresa (un bot por empresa)', (group) => {
    let api: ReturnType<typeof fetchTelegramFalso>
    group.each.setup(async () => {
        const restaurar = entornoPortal('prueba-telegram-empresas')
        await limpiarNotify()
        api = fetchTelegramFalso((_metodo, cuerpo) => respuestaTelegramOk(cuerpo))
        fijarTransporteTelegram({ fetch: api.fetch, apiRoot: 'http://telegram.prueba' })
        return async () => {
            await limpiarNotify()
            restaurar()
            await soloEmpresaPrincipal()
        }
    })

    /** Norte hereda el bot global (GrupoBot); Sur tiene el suyo (FibraSurBot). */
    async function bots() {
        const correo = { host: 'smtp.isp.example', remitente: 'avisos@isp.example' }
        await configurar({
            correo,
            telegram: { token: TOKEN_GLOBAL, bot_nombre: 'GrupoBot', webhook_secreto: SECRETO_GLOBAL },
        })
        const e = await dosEmpresas()
        await configurar({
            empresa_id: e.sur,
            hereda: false,
            correo,
            telegram: { token: TOKEN_SUR, bot_nombre: 'FibraSurBot', webhook_secreto: SECRETO_SUR },
        })
        return e
    }

    function webhook(client: ApiClient, bot: string, secreto: string, chat: number, texto: string) {
        return client
            .post(`/api/v1/telegram/webhook/${bot}`)
            .header('X-Telegram-Bot-Api-Secret-Token', secreto)
            .json({
                update_id: randomInt(1, 1_000_000_000),
                message: { message_id: 1, chat: { id: chat, type: 'private' }, text: texto },
            })
    }

    const leerTelegram = async (client: ApiClient, cookie: string) =>
        leer(client.get('/api/v1/portal/telegram').header('Cookie', cookie), 200)

    test('una tarjeta por empresa: el código de Sur es de su bot y solo vincula ese bot', async ({
        client,
        assert,
    }) => {
        const e = await bots()
        const chat = 6_100_000_000 + randomInt(0, 800_000_000)

        const inicial = await leerTelegram(client, e.cookie)
        assert.deepEqual(
            inicial.empresas.map(
                (t: { empresa: { id: number }; bot: string; vinculado: boolean; disponible: boolean }) => [
                    t.empresa.id,
                    t.bot,
                    t.disponible,
                    t.vinculado,
                ],
            ),
            [
                [e.norte, 'GrupoBot', true, false],
                [e.sur, 'FibraSurBot', true, false],
            ],
        )

        const vincular = (cuerpo: Record<string, unknown>) =>
            client
                .post('/api/v1/portal/telegram/vincular')
                .header('Cookie', e.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json(cuerpo)

        const codigoSur = await leer(vincular({ empresa_id: e.sur }), 201)
        assert.equal(codigoSur.bot, 'FibraSurBot')
        assert.equal(codigoSur.empresa_id, e.sur)
        assert.equal(codigoSur.enlace, `https://t.me/FibraSurBot?start=${codigoSur.codigo}`)

        // En su bot vincula; Norte (bot global) sigue sin vincular
        await estado(webhook(client, '8880012', SECRETO_SUR, chat, `/start ${codigoSur.codigo}`), 200)
        const despues = await leerTelegram(client, e.cookie)
        assert.isTrue(despues.vinculado)
        assert.deepEqual(
            despues.empresas.map((t: { empresa: { id: number }; vinculado: boolean }) => [
                t.empresa.id,
                t.vinculado,
            ]),
            [
                [e.norte, false],
                [e.sur, true],
            ],
        )

        // El código de Norte es del bot global
        const codigoNorte = await leer(vincular({ empresa_id: e.norte }), 201)
        assert.equal(codigoNorte.bot, 'GrupoBot')
        assert.equal(codigoNorte.empresa_id, e.norte)

        // Una empresa en la que el cliente no tiene servicios: 404, sin código
        const ajena = await crearEmpresaFila({ nombre_comercial: unico('Ajena') })
        await estado(vincular({ empresa_id: ajena }), 404)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.telegram_codigo')
            .where('entidad_id', e.clienteId)
            .where('resultado', 'ok')
            .count('* as n')
        assert.equal(Number(auditoria[0].n), 2)
    })

    test('código de acceso por Telegram: sale por un bot que el cliente inició, con la marca de esa empresa', async ({
        client,
        assert,
    }) => {
        const e = await bots()
        const chat = 6_200_000_000 + randomInt(0, 700_000_000)
        await db.from('core.clientes').where('id', e.clienteId).update({ canal_preferido: 'telegram' })

        const codigoSur = await leer(
            client
                .post('/api/v1/portal/telegram/vincular')
                .header('Cookie', e.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ empresa_id: e.sur }),
            201,
        )
        await estado(webhook(client, '8880012', SECRETO_SUR, chat, `/start ${codigoSur.codigo}`), 200)

        // Desde /corte de Norte (cuyo bot no lo tiene): el código va por el bot de Sur
        await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', e.deNorte.ip)
                .json({ por_ip: true }),
            202,
        )
        const envio = await db
            .from('notify.envios')
            .where('cliente_id', e.clienteId)
            .where('evento', 'portal.codigo_acceso')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(envio.canal, 'telegram')
        assert.equal(envio.destino, String(chat))
        assert.equal(Number(envio.empresa_id), e.sur)
        const mensaje = api.llamadas.at(-1)!
        assert.include(mensaje.url, `/bot${TOKEN_SUR}/sendMessage`)
        const sur = await db.from('core.empresas').where('id', e.sur).firstOrFail()
        assert.include(String(mensaje.cuerpo.text), sur.nombre_comercial)
    })
})
